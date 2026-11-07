<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from '#imports'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { Send, LoaderCircle, ExternalLink, X, Copy, Check } from '@lucide/vue'
import { tierHas } from '#shared/plans'
import { formatDate } from '~/utils/format'

/**
 * The event's Telegram notifications (Pro and up — shared/plans.ts):
 * the couple connects their own chats to the Memour bot, which sends a
 * digest of guest uploads, "payment received" and the reminders to
 * download the archive (server/utils/telegram-couple.ts).
 *
 * Connect: POST /api/couple/telegram/link/[id] returns a one-time
 * t.me link (15 minutes). The card tries to open it and always shows
 * it as a button too — a phone's browser blocks a window opened after
 * a request — plus «copy the link» and, from sm up, a QR code: on a
 * computer without Telegram Desktop the couple scans it with the phone.
 * While the link is fresh the list is polled (and re-read when the tab
 * comes back into focus); a new chat, or a chat connected again (same
 * row, fresher linked_at), ends the wait with a toast. Each chat can
 * be disconnected («Uzish / Отключить»).
 *
 * Basic: the same card with a «Pro» mark; the button opens the note on
 * what a higher tier adds. Hidden once the album is purged — there is
 * nothing left to report.
 */
const props = defineProps<{ eventId: string; planTier: string | null }>()

interface ChatLink { id: string; first_name: string | null; username: string | null; linked_at: string }
interface LinksResponse { links: ChatLink[]; ready: boolean }

const { t, locale } = useI18n()
const requestFetch = useRequestFetch()
const { toast } = useToast()
const errMsg = useErrorMessage()
const reduceMotion = useReducedMotion()

const inPlan = computed(() => tierHas(props.planTier, 'telegram_bot'))
const upgradeOpen = ref(false)

const { data, error: listErr, refresh } = await useAsyncData(
  `tg-links-${props.eventId}`,
  () => inPlan.value
    ? requestFetch<LinksResponse>(`/api/couple/telegram/links/${props.eventId}`)
    : Promise.resolve(null),
)
const links = computed(() => data.value?.links ?? [])
const ready = computed(() => data.value?.ready !== false)

// ─── Connect ─────────────────────────────────────────────────────────
const POLL_MS = 3000
type Phase = 'idle' | 'preparing' | 'waiting'
const phase = ref<Phase>('idle')
const deepLink = ref<string | null>(null)
const expired = ref(false)
let expiresAt = 0
// id → linked_at of the chats listed when the link was made. Connecting
// a chat that is already listed keeps its row and only moves linked_at.
let known = new Map<string, number>()
let poll: ReturnType<typeof setInterval> | null = null

function stopWaiting() {
  if (poll) clearInterval(poll)
  poll = null
  if (import.meta.client) window.removeEventListener('focus', check)
  phase.value = 'idle'
  deepLink.value = null
}

const isNewLink = (l: ChatLink) => {
  const before = known.get(l.id)
  return before === undefined || Date.parse(l.linked_at) > before
}

async function check() {
  if (phase.value !== 'waiting') return
  if (Date.now() > expiresAt) {
    stopWaiting()
    expired.value = true
    return
  }
  try {
    const res = await $fetch<LinksResponse>(`/api/couple/telegram/links/${props.eventId}`)
    data.value = res
    if (res.links.some(isNewLink)) {
      stopWaiting()
      toast.success(t('couple.telegram.connectedToast'))
    }
  } catch {
    // A missed poll is retried on the next tick.
  }
}

async function connect() {
  if (phase.value !== 'idle') return
  phase.value = 'preparing'
  expired.value = false
  try {
    const res = await $fetch<{ url: string; expires_at: string }>(
      `/api/couple/telegram/link/${props.eventId}`,
      { method: 'POST', body: { locale: locale.value } },
    )
    known = new Map(links.value.map((l) => [l.id, Date.parse(l.linked_at)]))
    copied.value = false
    expiresAt = Date.parse(res.expires_at)
    deepLink.value = res.url
    phase.value = 'waiting'
    // Desktop browsers open it; a phone may block a window opened after
    // a request — the button in the panel below is there for that.
    window.open(res.url, '_blank', 'noopener')
    poll = setInterval(check, POLL_MS)
    window.addEventListener('focus', check)
  } catch (e) {
    phase.value = 'idle'
    toast.error(errMsg(e))
  }
}

onBeforeUnmount(stopWaiting)

// ─── The link, for another device ────────────────────────────────────
const copied = ref(false)
async function copyLink() {
  const url = deepLink.value
  if (!url) return
  let ok = false
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(url)
      ok = true
    }
  } catch {
    // fall through to the legacy path
  }
  if (!ok) {
    // Plain-http deploys have no Clipboard API.
    const ta = document.createElement('textarea')
    ta.value = url
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch { ok = false }
    ta.remove()
  }
  if (ok) {
    copied.value = true
    toast.success(t('couple.telegram.linkCopied'))
  } else {
    toast.error(t('couple.telegram.copyFailed'))
  }
}

// QR of the deep link, drawn in the browser (the encoder loads only
// here) and shown from sm up — a phone opens the link directly.
const qrSrc = ref<string | null>(null)
watch(deepLink, async (url) => {
  qrSrc.value = null
  if (!url || !import.meta.client || !window.matchMedia('(min-width: 640px)').matches) return
  try {
    const QR = await import('qrcode')
    const svg = await QR.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
    if (deepLink.value === url) qrSrc.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  } catch {
    // No QR: the button and the copy link still work.
  }
})

// ─── Disconnect ──────────────────────────────────────────────────────
const removing = ref(new Set<string>())
async function disconnect(l: ChatLink) {
  if (removing.value.has(l.id)) return
  removing.value.add(l.id)
  try {
    await $fetch(`/api/couple/telegram/links/${props.eventId}/${l.id}`, { method: 'DELETE' })
    if (data.value) data.value = { ...data.value, links: data.value.links.filter((x) => x.id !== l.id) }
    toast.success(t('couple.telegram.disconnectedToast'))
  } catch (e) {
    toast.error(errMsg(e))
    await refresh()
  } finally {
    removing.value.delete(l.id)
  }
}

const nameOf = (l: ChatLink) => l.first_name || t('couple.telegram.unnamed')
const initialOf = (l: ChatLink) => (l.first_name || l.username || 'T').trim().charAt(0).toUpperCase()

const spring = computed(() => reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.35 })
const enter = computed(() => reduceMotion.value ? { opacity: 0 } : { opacity: 0, y: -6 })

const primaryLook = 'inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-70'
const primaryBtn = `${primaryLook} h-11`
const quietBtn = 'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97] disabled:opacity-60'
</script>

<template>
  <section id="telegram" class="surface-card mb-6 rounded-(--radius-xl) p-5 sm:p-6" :aria-labelledby="`tg-title-${eventId}`">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-600">
          <Send class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
        </div>
        <div class="min-w-0">
          <h2 :id="`tg-title-${eventId}`" class="font-display text-xl">{{ t('couple.telegram.title') }}</h2>
          <p class="mt-1 text-sm text-(--color-muted-foreground)">{{ t('couple.telegram.desc') }}</p>
        </div>
      </div>

      <!-- Not in this tier: marked, and it opens the note on what Pro adds. -->
      <button
        v-if="!inPlan"
        type="button"
        :class="[quietBtn, 'text-(--color-muted-foreground)']"
        :aria-expanded="upgradeOpen"
        :aria-controls="`tg-upgrade-${eventId}`"
        @click="upgradeOpen = !upgradeOpen"
      >
        <Send class="h-4 w-4" :stroke-width="1.6" aria-hidden="true" />
        {{ t('couple.telegram.connect') }}
        <span class="rounded-full bg-(--color-accent)/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-(--color-primary)">{{ t('pricing.pro.name') }}</span>
      </button>
      <button
        v-else-if="ready && phase !== 'waiting' && !listErr"
        type="button"
        :disabled="phase === 'preparing'"
        :aria-busy="phase === 'preparing'"
        :class="primaryBtn"
        @click="connect"
      >
        <LoaderCircle v-if="phase === 'preparing'" class="h-4 w-4 animate-spin" aria-hidden="true" />
        <Send v-else class="h-4 w-4" :stroke-width="1.8" aria-hidden="true" />
        {{ phase === 'preparing' ? t('couple.telegram.preparing') : links.length ? t('couple.telegram.connectMore') : t('couple.telegram.connect') }}
      </button>
    </div>

    <AnimatePresence>
      <motion.div
        v-if="!inPlan && upgradeOpen"
        :id="`tg-upgrade-${eventId}`"
        class="mt-4"
        :initial="enter"
        :animate="{ opacity: 1, y: 0 }"
        :exit="enter"
        :transition="spring"
      >
        <DashboardUpgradeNote :title="t('couple.telegram.upgradeTitle')" :desc="t('couple.telegram.upgradeDesc')" />
      </motion.div>
    </AnimatePresence>

    <template v-if="inPlan">
      <!-- The link is out: open Telegram, press Start; the list updates by itself. -->
      <AnimatePresence>
        <motion.div
          v-if="phase === 'waiting' && deepLink"
          class="relative mt-4 rounded-md border border-sky-200 bg-sky-50/70 p-4"
          role="status"
          :initial="enter"
          :animate="{ opacity: 1, y: 0 }"
          :exit="enter"
          :transition="spring"
        >
          <div class="flex items-start gap-3 sm:gap-4">
            <div class="min-w-0 flex-1">
              <!-- pr: the cancel button sits in the corner. -->
              <div class="flex items-start gap-2.5 pr-8 sm:pr-0">
                <LoaderCircle class="mt-0.5 h-4 w-4 shrink-0 animate-spin text-sky-600" aria-hidden="true" />
                <div class="min-w-0">
                  <p class="font-medium">{{ t('couple.telegram.waitingTitle') }}</p>
                  <p class="mt-0.5 text-sm text-(--color-muted-foreground)">{{ t('couple.telegram.waitingDesc') }}</p>
                </div>
              </div>
              <div class="mt-3 flex flex-wrap gap-2 sm:pl-6.5">
                <!-- One line each; on a phone they wrap and take the whole row. -->
                <a :href="deepLink" target="_blank" rel="noopener" :class="[primaryLook, 'h-10 grow whitespace-nowrap sm:grow-0']">
                  <ExternalLink class="h-4 w-4" :stroke-width="1.8" aria-hidden="true" />
                  {{ t('couple.telegram.openTelegram') }}
                </a>
                <button type="button" :class="[quietBtn, 'grow whitespace-nowrap sm:grow-0']" @click="copyLink">
                  <Check v-if="copied" class="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  <Copy v-else class="h-4 w-4" :stroke-width="1.8" aria-hidden="true" />
                  {{ t('couple.telegram.copyLink') }}
                </button>
              </div>
            </div>
            <!-- A computer without Telegram: scan with the phone. -->
            <figure v-if="qrSrc" class="hidden w-32 shrink-0 text-center sm:mr-10 sm:block">
              <img :src="qrSrc" :alt="t('couple.telegram.qrAlt')" width="128" height="128" class="h-32 w-32 rounded-md bg-white p-1 ring-1 ring-sky-200">
              <figcaption class="mt-1.5 text-xs leading-snug text-(--color-muted-foreground)">{{ t('couple.telegram.qrHint') }}</figcaption>
            </figure>
          </div>
          <!-- Stop waiting: the link just expires unused. -->
          <button
            type="button"
            class="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full text-(--color-muted-foreground) transition-[transform,background-color,color] duration-150 hover:bg-white hover:text-(--color-foreground) active:scale-90"
            :aria-label="t('common.cancel')"
            :title="t('common.cancel')"
            @click="stopWaiting"
          >
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </motion.div>
      </AnimatePresence>

      <p v-if="expired" class="mt-4 text-sm text-amber-800" role="status">{{ t('couple.telegram.expired') }}</p>
      <p v-if="!ready" class="mt-4 text-sm text-(--color-muted-foreground)">{{ t('errors.telegram_unavailable') }}</p>

      <div v-if="listErr && !data" class="mt-4 flex flex-wrap items-center gap-3 text-sm text-(--color-muted-foreground)" role="alert">
        {{ t('couple.telegram.loadError') }}
        <button type="button" :class="quietBtn" @click="refresh()">{{ t('common.retry') }}</button>
      </div>

      <ul v-else-if="links.length" class="mt-4 divide-y divide-(--color-border) rounded-md border border-(--color-border) bg-white">
        <li v-for="l in links" :key="l.id" class="flex items-center gap-2 py-2.5 pl-4 pr-2 sm:gap-3 sm:px-4">
          <!-- Decorative; on a phone the name and the button need the room. -->
          <span class="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-sm font-medium text-sky-700 sm:grid" aria-hidden="true">{{ initialOf(l) }}</span>
          <div class="min-w-0 flex-1">
            <!-- Wraps rather than cuts: the username is how a couple tells two chats apart. -->
            <p class="text-sm font-medium [overflow-wrap:anywhere]">
              {{ nameOf(l) }}<span v-if="l.username" class="font-normal text-(--color-muted-foreground)"> · @{{ l.username }}</span>
            </p>
            <p class="text-xs text-(--color-muted-foreground)">{{ t('couple.telegram.since', { date: formatDate(l.linked_at, locale) }) }}</p>
          </div>
          <button
            type="button"
            :disabled="removing.has(l.id)"
            :aria-label="t('couple.telegram.disconnectAria', { name: nameOf(l) })"
            class="-mr-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm text-(--color-muted-foreground) transition-[transform,background-color,color] duration-150 hover:bg-red-50 hover:text-red-700 active:scale-[0.97] disabled:opacity-60 sm:mr-0 sm:gap-1.5 sm:px-3"
            @click="disconnect(l)"
          >
            <LoaderCircle v-if="removing.has(l.id)" class="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" aria-hidden="true" />
            <X v-else class="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            {{ t('couple.telegram.disconnect') }}
          </button>
        </li>
      </ul>

      <p v-else-if="ready && phase !== 'waiting'" class="mt-4 text-sm text-(--color-muted-foreground)">{{ t('couple.telegram.empty') }}</p>
    </template>
  </section>
</template>
