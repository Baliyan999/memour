<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useLocalePath } from '#imports'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import {
  QrCode, Copy, Check, ChevronDown, Download, Play, Mic, Star, ArchiveRestore, LoaderCircle, RefreshCw,
} from '@lucide/vue'
import type { Database } from '~/types/database.types'
import { formatDate, formatDuration } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })

/**
 * Couple event detail. RLS limits the event SELECT to events owned by
 * the logged-in user, so a couple can never load somebody else's event.
 *
 * Media comes from /api/couple/event/[id]/photos: keyset pages of 60,
 * newest first, with signed URLs (hidden items included — the public
 * /api/photo refuses those) and real COUNT(*) totals for the stats and
 * filter chips. The grid loads the next page as its end scrolls into
 * view, so events of any size stay reachable.
 */
const { t, te, locale } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const config = useRuntimeConfig()
const supabase = useSupabaseClient<Database>()
const requestFetch = useRequestFetch()
const { toast } = useToast()
// No 'couple' scope: couple.errors.* is the login page's wording (its
// rate_limited is about login attempts, not about QR or ZIP downloads).
const errMsg = useErrorMessage()
const { consentFor, salesTermsPath, live: legalLive } = useLegal()
const reduceMotion = useReducedMotion()

const id = route.params.id as string

const { data: ev, error: evErr, refresh: refreshEv } = await useAsyncData(`event-${id}`, async () => {
  const { data, error } = await supabase
    .from('events')
    .select('*, branding(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
})

// No row (RLS hides other couples' events too) → the localized 404
// page. Any other failure gets an inline retry instead of pretending
// the event doesn't exist.
if (!evErr.value && !ev.value) {
  throw createError({ statusCode: 404, statusMessage: 'event_not_found', fatal: true })
}


// ─── Media list ──────────────────────────────────────────────────────
interface Media {
  id: string
  media_type: 'photo' | 'video' | 'voice'
  mime_type: string | null
  duration_ms: number | null
  is_hidden: boolean
  is_highlight: boolean
  guest_name: string | null
  guest_table: number | null
  uploaded_at: string
  url: string | null
  thumb_url: string | null
}
interface Counts {
  total: number
  visible: number
  hidden: number
  highlights: number
  video: number
  voice: number
  tables: number[]
}
interface Page { items: Media[]; next: string | null; counts?: Counts }

const PAGE_SIZE = 60

type FilterKey = 'visible' | 'highlights' | 'hidden' | 'by_table'
const filter = ref<FilterKey>('visible')
const tableFilter = ref<number | null>(null)

function listQuery() {
  if (filter.value === 'by_table' && tableFilter.value) return { filter: 'all', table: tableFilter.value }
  return { filter: filter.value === 'by_table' ? 'visible' : filter.value }
}

const { data: firstPage, error: listErr, pending: listPending, refresh: refreshList } = await useAsyncData(
  `photos-${id}`,
  () => requestFetch<Page>(`/api/couple/event/${id}/photos`, {
    query: { ...listQuery(), counts: 1, limit: PAGE_SIZE },
  }),
  { watch: [filter, tableFilter] },
)

const counts = ref<Counts | null>(firstPage.value?.counts ?? null)
const items = ref<Media[]>(firstPage.value?.items ?? [])
const nextCursor = ref<string | null>(firstPage.value?.next ?? null)
// Bumped on every fresh first page: the grid remounts and cross-fades
// in as a whole instead of 60 tiles exiting while 60 others enter.
const gridKey = ref(0)
watch(firstPage, (page) => {
  // A failed fetch resets the page to undefined: drop the previous
  // filter's tiles and cursor so they never pose as this filter's
  // result (or get the next page glued onto them).
  if (!page) {
    items.value = []
    nextCursor.value = null
    return
  }
  items.value = page.items
  nextCursor.value = page.next
  if (page.counts) counts.value = page.counts
  gridKey.value += 1
})

const listKey = computed(() => `${filter.value}:${tableFilter.value ?? ''}`)
const loadingMore = ref(false)
async function loadMore() {
  if (!nextCursor.value || loadingMore.value || listPending.value) return
  loadingMore.value = true
  const key = listKey.value
  try {
    const page = await $fetch<Page>(`/api/couple/event/${id}/photos`, {
      query: { ...listQuery(), cursor: nextCursor.value, limit: PAGE_SIZE },
    })
    if (key !== listKey.value) return // filter changed while loading
    const seen = new Set(items.value.map((p) => p.id))
    items.value.push(...page.items.filter((p) => !seen.has(p.id)))
    nextCursor.value = page.next
  } catch (e) {
    toast.error(errMsg(e))
    return
  } finally {
    loadingMore.value = false
  }
  // Tall screens: the sentinel can still be in view after a page lands,
  // and the observer only fires on changes — keep filling.
  await nextTick()
  const rect = sentinel.value?.getBoundingClientRect()
  if (rect && rect.top < window.innerHeight + 600) loadMore()
}

// Infinite scroll: the "show more" button doubles as the sentinel.
const sentinel = ref<HTMLElement | null>(null)
useIntersectionObserver(sentinel, (entries) => {
  if (entries.some((e) => e.isIntersecting)) loadMore()
}, { rootMargin: '600px 0px' })

const photoCount = computed(() => counts.value ? counts.value.total - counts.value.video - counts.value.voice : 0)
const tables = computed(() => counts.value?.tables ?? [])

function setFilter(f: FilterKey) {
  filter.value = f
  tableFilter.value = null
}

// Tiles that exist at hydration render as-is (never hidden behind an
// animation); tiles added later — next page, filter switch — fade up.
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })
const tileEnter = computed(() => reduceMotion.value ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 })
const tileExit = computed(() => reduceMotion.value ? { opacity: 0 } : { opacity: 0, scale: 0.9 })
const spring = computed(() => reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.35 })

// Restore a hidden item straight from the grid.
const restoring = ref(new Set<string>())
async function restore(p: Media) {
  if (restoring.value.has(p.id)) return
  restoring.value.add(p.id)
  try {
    await $fetch(`/api/couple/photo/${p.id}`, { method: 'PATCH', body: { is_hidden: false } })
    p.is_hidden = false
    if (filter.value === 'hidden') items.value = items.value.filter((x) => x.id !== p.id)
    if (counts.value) {
      counts.value.hidden -= 1
      counts.value.visible += 1
      if (p.is_highlight) counts.value.highlights += 1
    }
    toast.success(t('couple.event.restoredToast'))
  } catch (e) {
    toast.error(errMsg(e))
  } finally {
    restoring.value.delete(p.id)
  }
}

// ─── Dates / labels ──────────────────────────────────────────────────
const fmtDate = (d: string) => formatDate(d, locale.value)

// ─── QR codes & table links ──────────────────────────────────────────
// Same URL the printed QR codes carry: the guest page needs `?t=N` to
// bind the phone to a table; without it guests hit "scan your QR".
// The locale is always embedded in the path so the link resolves
// regardless of the visitor's browser language setting; it's the
// dashboard's language, the same one the QR PDF button below prints.
const siteUrl = config.public.siteUrl.replace(/\/+$/, '')
const tableCount = computed(() => ev.value?.table_count ?? 10)
const tableUrl = (n: number) => `${siteUrl}/${locale.value}/e/${id}?t=${n}`
// The UUID is noise on screen; the table parameter is what matters.
const siteHost = siteUrl.replace(/^https?:\/\//, '')
const tableUrlShort = (n: number) => `${siteHost}/…?t=${n}`
const linksOpen = ref(false)
const copiedTable = ref<number | null>(null)

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  // Plain-http deploys have no Clipboard API.
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

async function copyTableUrl(n: number) {
  if (await copyText(tableUrl(n))) {
    copiedTable.value = n
    toast.success(t('couple.event.tableLinkCopied', { n }))
    setTimeout(() => { if (copiedTable.value === n) copiedTable.value = null }, 1600)
  } else {
    toast.error(t('couple.event.copyFailed'))
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const qrPending = ref(false)
async function downloadQr() {
  if (qrPending.value) return
  qrPending.value = true
  try {
    const res = await $fetch.raw<Blob>(`/api/couple/qr-pdf/${id}`, {
      responseType: 'blob',
      query: { lang: locale.value },
    })
    const cd = res.headers.get('content-disposition') ?? ''
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1]
    const name = star ? decodeURIComponent(star) : `memour-qr-${id.slice(0, 8)}.pdf`
    saveBlob(res._data as Blob, name)
  } catch (e: any) {
    // responseType blob → the JSON error body arrives as a Blob too.
    // FetchError.data is getter-only, so parse into a local instead.
    let body = e?.data
    if (body instanceof Blob) {
      try { body = JSON.parse(await body.text()) } catch { body = null }
    }
    toast.error(errMsg({ data: body, response: e?.response }))
  } finally {
    qrPending.value = false
  }
}

// ─── ZIP ─────────────────────────────────────────────────────────────
// Preflight with ?check=1 so auth / empty-album errors become a toast;
// the archive itself is a native download (streams to disk, never
// through JS memory).
const zipPending = ref(false)
async function downloadZip() {
  if (zipPending.value) return
  zipPending.value = true
  try {
    await $fetch(`/api/couple/zip/${id}`, { query: { check: 1 } })
    const a = document.createElement('a')
    a.href = `/api/couple/zip/${id}?lang=${locale.value}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.info(t('couple.event.zipStarted'), 6000)
    // Hold the button a moment: a double tap would start two archives.
    setTimeout(() => { zipPending.value = false }, 4000)
  } catch (e) {
    toast.error(errMsg(e))
    zipPending.value = false
  }
}

// ─── Archive / pay ───────────────────────────────────────────────────
const archivePending = ref(false)
async function archiveEvent() {
  if (!ev.value) return
  const ok = await confirmDialog({
    title: t('couple.event.archiveTitle'),
    description: t('couple.event.confirmArchive'),
    confirmLabel: t('couple.event.archiveButton'),
    cancelLabel: t('common.cancel'),
    tone: 'danger',
  })
  if (!ok) return
  archivePending.value = true
  try {
    await $fetch(`/api/couple/event/${ev.value.id}/status`, {
      method: 'PATCH',
      body: { status: 'archived' },
    })
    toast.success(t('couple.event.archivedToast'))
    await refreshEv()
  } catch (e: any) {
    // archive_before_wedding / payment_required / invalid_transition…;
    // a server-side failure is said in this action's own words.
    toast.error(errorInfo(e).status >= 500 ? t('couple.event.archiveError') : errMsg(e, { fallback: 'couple.event.archiveError' }))
  } finally {
    archivePending.value = false
  }
}

const payPending = ref(false)
const payError = ref<string | null>(null)
// Acceptance of the public offer (the interim terms until one is
// published) and of the date the files are deleted — required by
// checkout and recorded with the payment. The date goes to the server
// as shown, so the record holds the one the couple agreed to.
const acceptSales = ref(false)
const deletionLabel = computed(() => (ev.value?.archive_expires_at ? fmtDate(ev.value.archive_expires_at) : '—'))

// Only providers with their full key set get a button. Unknown (the
// request failed) → show both and let checkout answer with a code.
const { data: providers } = await useAsyncData(`providers-${id}`, () =>
  ev.value?.status === 'draft'
    ? requestFetch<{ payme: boolean; click: boolean }>('/api/checkout/providers').catch(() => null)
    : Promise.resolve(null),
)
const showPayme = computed(() => providers.value?.payme ?? true)
const showClick = computed(() => providers.value?.click ?? true)

async function startCheckout(provider: 'payme' | 'click') {
  if (!acceptSales.value) return
  payPending.value = true
  payError.value = null
  try {
    const res = await $fetch<{ url: string; payment_id: string; dev?: boolean }>(
      `/api/checkout/${provider}`,
      {
        method: 'POST',
        body: {
          event_id: id,
          locale: locale.value,
          consent: consentFor('checkout'),
          deletion_date: ev.value?.archive_expires_at ?? null,
        },
      },
    )
    if (res.dev) {
      // Dev fallback: payment marked paid server-side immediately,
      // just reload to pick up the new active status.
      window.location.reload()
      return
    }
    if (typeof window !== 'undefined') window.location.href = res.url
  } catch (e: any) {
    // A server-side failure is said in this action's own words — except
    // payments_unavailable (503), which names its reason and what to do.
    const { code, status } = errorInfo(e)
    payError.value = status >= 500 && code !== 'payments_unavailable'
      ? t('couple.event.payFailed')
      : errMsg(e, { fallback: 'couple.event.payFailed' })
    // Paid in another tab / activation healed server-side → show the real status.
    if (code === 'already_paid') await refreshEv()
    // The deletion date moved (wedding date or tier changed meanwhile):
    // show the new one and ask for the box again.
    if (code === 'deletion_date_changed' || code === 'consent_outdated') {
      acceptSales.value = false
      await refreshEv()
    }
  } finally {
    payPending.value = false
  }
}

const btn = 'inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97] disabled:opacity-60'
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- The event query failed for a reason other than "not found" -->
    <div v-if="evErr" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('couple.event.loadErrorTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ t('couple.event.loadErrorDesc') }}</p>
      <button type="button" :class="[btn, 'mt-5']" @click="refreshEv()">
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <template v-else-if="ev">
    <!-- Header -->
    <div class="mb-8">
      <NuxtLink
        :to="localePath('/dashboard')"
        class="mb-3 inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
      >
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {{ t('couple.event.back') }}
      </NuxtLink>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="min-w-0">
          <h1 class="heading-display-md break-words">{{ ev.couple_names }}</h1>
          <p class="mt-1 text-(--color-muted-foreground)">
            {{ fmtDate(ev.wedding_date) }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <NuxtLink :to="localePath(`/dashboard/event/${ev.id}/moderate`)" :class="btn">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="14 2 18 6 7 17 3 17 3 13 14 2" />
              <line x1="3" y1="22" x2="21" y2="22" />
            </svg>
            {{ t('couple.event.moderate') }}
          </NuxtLink>
          <NuxtLink :to="localePath(`/dashboard/event/${ev.id}/branding`)" :class="btn">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {{ t('couple.event.branding') }}
          </NuxtLink>
          <!-- The slideshow only runs for active events; it follows the couple's language. -->
          <a
            v-if="ev.status === 'active'"
            :href="localePath(`/e/${ev.id}/live`)"
            target="_blank"
            rel="noopener"
            :class="btn"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {{ t('couple.event.liveSlideshow') }}
          </a>
          <button
            v-if="ev.status === 'active'"
            type="button"
            :disabled="archivePending"
            :class="btn"
            @click="archiveEvent"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            {{ t('couple.event.archiveButton') }}
          </button>
          <!-- Nothing to download (yet, or any more) → no button that leads to an error. -->
          <button
            v-if="(counts?.visible ?? 0) > 0 && !ev.purged_at"
            type="button"
            :disabled="zipPending"
            :aria-busy="zipPending"
            class="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-4 text-sm font-medium text-(--color-primary-foreground) transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-70"
            @click="downloadZip"
          >
            <LoaderCircle v-if="zipPending" class="h-4 w-4 animate-spin" />
            <Download v-else class="h-4 w-4" :stroke-width="1.8" />
            {{ zipPending ? t('couple.event.zipPreparing') : t('couple.event.downloadArchive') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Pay-to-activate banner: shown only for draft events -->
    <div
      v-if="ev.status === 'draft'"
      class="mb-6 flex flex-col gap-4 rounded-(--radius-xl) border border-(--color-primary)/20 bg-gradient-to-br from-(--color-accent)/30 to-(--color-rose)/15 p-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p class="text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ t('couple.event.activationEyebrow') }}</p>
        <h2 class="mt-1 font-display text-2xl italic">{{ t('couple.event.activationTitle') }}</h2>
        <p class="mt-2 text-sm text-(--color-muted-foreground)">
          {{ t('couple.event.activationDescPrefix') }} <strong class="font-medium text-(--color-foreground)">{{ te(`pricing.${ev.plan_tier}.name`) ? t(`pricing.${ev.plan_tier}.name`) : '' }}</strong>
          · {{ t('couple.event.activationDescSuffix') }}
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:items-end">
        <p v-if="!showPayme && !showClick" class="max-w-xs text-sm text-(--color-muted-foreground) sm:text-right">
          {{ t('errors.payments_unavailable') }}
        </p>
        <div v-else class="max-w-xs">
          <LegalConsentCheckbox
            id="checkout-consent"
            v-model="acceptSales"
            :keypath="legalLive ? 'couple.event.offerConsent' : 'couple.event.termsConsent'"
            :link-text="t(legalLive ? 'couple.event.offerLink' : 'couple.event.termsLink')"
            :to="salesTermsPath()"
            :params="{ date: deletionLabel }"
          />
        </div>
        <button
          v-if="showPayme"
          type="button"
          :disabled="payPending || !acceptSales"
          class="inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90 disabled:opacity-60"
          @click="startCheckout('payme')"
        >{{ t('couple.event.payPayme') }}</button>
        <button
          v-if="showClick"
          type="button"
          :disabled="payPending || !acceptSales"
          class="inline-flex h-11 items-center justify-center rounded-md border border-(--color-border) bg-white px-6 text-sm font-medium hover:bg-(--color-muted) disabled:opacity-60"
          @click="startCheckout('click')"
        >{{ t('couple.event.payClick') }}</button>
        <p v-if="payError" class="text-xs text-red-600">{{ payError }}</p>
      </div>
    </div>

    <!-- QR codes + per-table guest links: what the couple hands to guests -->
    <section v-if="ev.status === 'active'" class="surface-card mb-6 rounded-(--radius-xl) p-5 sm:p-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-start gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--color-accent)/40 text-(--color-primary)">
            <QrCode class="h-5 w-5" :stroke-width="1.6" />
          </div>
          <div>
            <h2 class="font-display text-xl">{{ t('couple.event.qrTitle') }}</h2>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">{{ t('couple.event.qrDesc', { n: tableCount }) }}</p>
          </div>
        </div>
        <button
          type="button"
          :disabled="qrPending"
          :aria-busy="qrPending"
          class="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-70"
          @click="downloadQr"
        >
          <LoaderCircle v-if="qrPending" class="h-4 w-4 animate-spin" />
          <Download v-else class="h-4 w-4" :stroke-width="1.8" />
          {{ qrPending ? t('couple.event.qrPreparing') : t('couple.event.qrDownload') }}
        </button>
      </div>

      <button
        type="button"
        class="mt-4 inline-flex items-center gap-1.5 rounded-full text-sm text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
        :aria-expanded="linksOpen"
        aria-controls="table-links"
        @click="linksOpen = !linksOpen"
      >
        {{ t('couple.event.tableLinksToggle', { n: tableCount }) }}
        <ChevronDown class="h-4 w-4 transition-transform duration-200" :class="linksOpen ? 'rotate-180' : ''" />
      </button>
      <AnimatePresence>
        <motion.div
          v-if="linksOpen"
          id="table-links"
          :initial="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }"
          :transition="spring"
        >
          <p class="mt-3 text-xs text-(--color-muted-foreground)">{{ t('couple.event.tableLinksHint') }}</p>
          <ul class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <li
              v-for="n in tableCount"
              :key="n"
              class="flex min-w-0 items-center gap-2 rounded-md border border-(--color-border) bg-white py-1.5 pl-3 pr-1.5"
            >
              <span class="shrink-0 text-sm font-medium">{{ t('couple.event.tableLabel', { n }) }}</span>
              <a
                :href="tableUrl(n)"
                target="_blank"
                rel="noopener"
                class="min-w-0 flex-1 truncate text-xs text-(--color-muted-foreground) hover:text-(--color-foreground)"
              >{{ tableUrlShort(n) }}</a>
              <button
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-full text-(--color-muted-foreground) transition-[transform,background-color] duration-150 hover:bg-(--color-muted) hover:text-(--color-foreground) active:scale-90"
                :aria-label="t('couple.event.copyTableLink', { n })"
                @click="copyTableUrl(n)"
              >
                <Check v-if="copiedTable === n" class="h-4 w-4 text-emerald-600" />
                <Copy v-else class="h-4 w-4" />
              </button>
            </li>
          </ul>
        </motion.div>
      </AnimatePresence>
    </section>

    <!-- Stats -->
    <div class="mb-8">
      <div class="grid grid-cols-3 gap-2 sm:gap-4">
        <div class="surface-card min-w-0 rounded-(--radius-xl) p-4 sm:p-5">
          <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('couple.event.statPhotos') }}</p>
          <p class="mt-1 font-display text-2xl sm:text-3xl">{{ photoCount }}</p>
          <p v-if="counts && (counts.video || counts.voice)" class="mt-0.5 text-[11px] text-(--color-muted-foreground)">
            <span v-if="counts.video">{{ t('couple.event.statVideos', { n: counts.video }) }}</span>
            <span v-if="counts.video && counts.voice"> · </span>
            <span v-if="counts.voice">{{ t('couple.event.statVoices', { n: counts.voice }) }}</span>
          </p>
        </div>
        <div class="surface-card min-w-0 rounded-(--radius-xl) p-4 sm:p-5">
          <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('couple.event.statTables') }}</p>
          <p class="mt-1 font-display text-2xl sm:text-3xl">{{ ev.table_count ?? 0 }}</p>
        </div>
        <div class="surface-card min-w-0 rounded-(--radius-xl) p-4 sm:p-5">
          <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('couple.event.statStatus') }}</p>
          <!-- One word, never split mid-word: a size that fits "Черновик" /
               "Qoralama" in a third of a 375 px phone, hyphenation only as
               a fallback for a longer label. -->
          <p class="mt-1 font-display text-lg leading-tight hyphens-auto min-[400px]:text-xl sm:text-3xl">{{ t(`couple.statusBadge.${ev.status}`) }}</p>
        </div>
      </div>
      <!-- Retention: until when the media is kept (wedding + 180 days, Luxury 365) -->
      <p v-if="ev.status !== 'draft' && !ev.purged_at && ev.archive_expires_at" class="mt-3 text-xs text-(--color-muted-foreground)">
        {{ t('couple.event.storedUntil', { date: fmtDate(ev.archive_expires_at) }) }}
      </p>
    </div>

    <!-- List failed to load -->
    <div v-if="listErr && !counts" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('couple.event.loadErrorTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ errMsg(listErr) }}</p>
      <button type="button" :class="[btn, 'mt-5']" @click="refreshList()">
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- Retention purge ran: the media is gone for good -->
    <div v-else-if="ev.purged_at" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('couple.event.purgedTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">
        {{ t('couple.event.purgedDesc', { date: fmtDate(ev.archive_expires_at ?? ev.purged_at) }) }}
      </p>
    </div>

    <!-- Empty / photos grid -->
    <div v-else-if="!counts || counts.total === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('couple.event.noPhotosYet') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">
        {{ t('couple.event.noPhotosDesc') }}
      </p>
    </div>

    <template v-else>
      <!-- Filter chips -->
      <div class="mb-4 flex flex-wrap items-center gap-2" role="toolbar">
        <button
          type="button"
          :aria-pressed="filter === 'visible'"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]',
            filter === 'visible'
              ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="setFilter('visible')"
        >{{ t('couple.event.filterAll') }}
          <span class="rounded-full bg-white/30 px-1.5 text-[10px]" v-if="filter === 'visible'">{{ counts.visible }}</span>
          <span class="text-[10px] text-(--color-muted-foreground)" v-else>{{ counts.visible }}</span>
        </button>
        <button
          type="button"
          :aria-pressed="filter === 'highlights'"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]',
            filter === 'highlights'
              ? 'border-amber-400 bg-amber-400 text-white'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="setFilter('highlights')"
        >
          <Star class="h-3 w-3 fill-current" />
          {{ t('couple.event.filterHighlights') }}
          <span class="text-[10px]">{{ counts.highlights }}</span>
        </button>
        <button
          v-if="counts.hidden > 0 || filter === 'hidden'"
          type="button"
          :aria-pressed="filter === 'hidden'"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.96]',
            filter === 'hidden'
              ? 'border-(--color-muted-foreground) bg-(--color-muted-foreground) text-white'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="setFilter('hidden')"
        >{{ t('couple.event.filterHidden') }} <span class="text-[10px]">{{ counts.hidden }}</span></button>

        <div v-if="tables.length > 0" class="ml-2 flex items-center gap-1">
          <span class="text-xs text-(--color-muted-foreground)">{{ t('couple.event.filterByTable') }}:</span>
          <select
            v-model.number="tableFilter"
            :class="[
              'h-8 rounded-full border bg-white px-3 text-xs',
              filter === 'by_table' ? 'border-(--color-primary)' : 'border-(--color-border)',
            ]"
            @change="filter = tableFilter ? 'by_table' : 'visible'"
          >
            <option :value="null">{{ t('couple.event.filterAllOption') }}</option>
            <option v-for="tbl in tables" :key="tbl" :value="tbl">{{ tbl }}</option>
          </select>
        </div>
      </div>

      <p v-if="filter === 'hidden'" class="mb-3 text-xs text-(--color-muted-foreground)">
        {{ t('couple.event.hiddenHint') }}
      </p>

      <!-- This filter's page failed: say so, never keep the previous tiles -->
      <div v-if="listErr" class="surface-card rounded-(--radius-xl) p-10 text-center" role="alert">
        <p class="text-(--color-muted-foreground)">{{ errMsg(listErr) }}</p>
        <button type="button" :disabled="listPending" :class="[btn, 'mt-5']" @click="refreshList()">
          <LoaderCircle v-if="listPending" class="h-4 w-4 animate-spin" />
          <RefreshCw v-else class="h-4 w-4" />
          {{ t('common.retry') }}
        </button>
      </div>

      <div
        v-else-if="!listPending && items.length === 0"
        class="surface-card rounded-(--radius-xl) p-10 text-center text-(--color-muted-foreground)"
      >
        {{ t('couple.event.emptyFilter') }}
      </div>

      <div
        v-else
        class="transition-opacity duration-200"
        :class="listPending ? 'opacity-50' : ''"
        :aria-busy="listPending"
      >
      <motion.div
        :key="gridKey"
        :initial="hydrated ? { opacity: 0 } : false"
        :animate="{ opacity: 1 }"
        :transition="spring"
        class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        <AnimatePresence :initial="false">
          <motion.div
            v-for="p in items"
            :key="p.id"
            :initial="tileEnter"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :exit="tileExit"
            :transition="spring"
            class="surface-card group relative aspect-square overflow-hidden rounded-md"
          >
            <!-- Owner endpoint: opens hidden media too. -->
            <a
              :href="`/api/couple/photo/${p.id}`"
              target="_blank"
              rel="noopener"
              class="block h-full w-full transition-transform duration-150 active:scale-[0.98]"
              :class="p.is_hidden ? 'opacity-50' : ''"
              :aria-label="t(`couple.event.open_${p.media_type}`)"
            >
              <img
                v-if="p.media_type === 'photo' && p.thumb_url"
                :src="p.thumb_url"
                alt=""
                class="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
                draggable="false"
              >
              <template v-else-if="p.media_type === 'video'">
                <!-- #t=0.1 makes iOS paint the first frame as a poster -->
                <video
                  v-if="p.url"
                  :src="`${p.url}#t=0.1`"
                  preload="metadata"
                  muted
                  playsinline
                  class="pointer-events-none h-full w-full bg-black object-cover"
                />
                <span class="absolute inset-0 grid place-items-center">
                  <span class="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                    <Play class="ml-0.5 h-5 w-5 fill-current" />
                  </span>
                </span>
              </template>
              <span
                v-else-if="p.media_type === 'voice'"
                class="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-(--color-accent)/50 to-(--color-rose)/25 text-(--color-primary)"
              >
                <span class="grid h-11 w-11 place-items-center rounded-full bg-white/80 shadow-sm">
                  <Mic class="h-5 w-5" :stroke-width="1.8" />
                </span>
                <span class="text-xs text-(--color-muted-foreground)">{{ t('couple.event.voiceLabel') }}</span>
              </span>
            </a>
            <span
              v-if="p.media_type !== 'photo' && p.duration_ms"
              class="pointer-events-none absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white tabular-nums"
            >{{ formatDuration(p.duration_ms) }}</span>
            <span
              v-if="p.is_highlight"
              class="pointer-events-none absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-white shadow"
            >
              <Star class="h-3 w-3 fill-current" />
            </span>
            <span
              v-if="p.guest_table"
              class="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white"
            >{{ t('couple.event.tableBadge', { n: p.guest_table }) }}</span>
            <button
              v-if="p.is_hidden"
              type="button"
              :disabled="restoring.has(p.id)"
              class="absolute left-1.5 top-1.5 inline-flex h-8 items-center gap-1 rounded-full bg-white/95 px-2.5 text-xs font-medium text-(--color-foreground) shadow transition-transform duration-150 active:scale-95 disabled:opacity-60"
              @click="restore(p)"
            >
              <ArchiveRestore class="h-3.5 w-3.5" />
              {{ t('couple.event.restore') }}
            </button>
          </motion.div>
        </AnimatePresence>
      </motion.div>
      </div>

      <div v-if="nextCursor && items.length > 0" ref="sentinel" class="mt-6 flex justify-center">
        <button type="button" :disabled="loadingMore" :class="btn" @click="loadMore">
          <LoaderCircle v-if="loadingMore" class="h-4 w-4 animate-spin" />
          {{ loadingMore ? t('couple.event.loadingMore') : t('couple.event.loadMore') }}
        </button>
      </div>
    </template>
    </template>
  </div>
</template>
