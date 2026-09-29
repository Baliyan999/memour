<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useLocalePath } from '#imports'
import { motion, useReducedMotion } from 'motion-v'
import { X, Heart, Star, Undo2, ArchiveRestore, EyeOff, RefreshCw } from '@lucide/vue'
import type { ModerationItem, SwipeDir } from '~/components/dashboard/ModerationCard.vue'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/event/[id]/moderate — Tinder-style swipe moderation.
 *
 * Two tabs:
 *   Review — visible items. Left = HIDE (is_hidden=true), right = KEEP,
 *            ★ (or swipe up via the button/keys) = HIGHLIGHT and keep.
 *   Hidden — what was hidden before. Right = BRING BACK (unhide),
 *            left = leave hidden, ★ = bring back as a highlight.
 *
 * Implementation notes:
 *   - The queue is paged from /api/couple/event/[id]/photos (signed
 *     URLs, hidden items included) and refilled as it runs low, so
 *     events above PostgREST's row cap are fully reachable.
 *   - Decisions are optimistic: the card leaves at once and the PATCH
 *     runs behind it. Requests for the same photo are chained, so an
 *     undo can never overtake the change it reverts. A failed request
 *     puts the card back with a toast.
 *   - Undo is a stack (not one level) and works across fast swipes.
 *   - Keyboard shortcuts live only while this page is mounted
 *     (useEventListener removes the listener on unmount).
 */
const { t } = useI18n()
const errMsg = useErrorMessage()
const route = useRoute()
const localePath = useLocalePath()
const requestFetch = useRequestFetch()
const { toast } = useToast()
const reduceMotion = useReducedMotion()
const id = route.params.id as string

type Tab = 'review' | 'hidden'
type Item = ModerationItem
interface Page {
  items: Item[]
  next: string | null
  counts?: { visible: number; hidden: number }
}

const PAGE_SIZE = 30
const tab = ref<Tab>('review')

const { data: firstPage, error: loadErr, pending, refresh } = await useAsyncData(
  `moderate-${id}`,
  () => requestFetch<Page>(`/api/couple/event/${id}/photos`, {
    query: { filter: tab.value === 'hidden' ? 'hidden' : 'visible', counts: 1, limit: PAGE_SIZE },
  }),
  { watch: [tab] },
)
// Another couple's event (403) or none at all (404) → the localized 404
// page, as on the event and branding pages. Other failures keep the
// inline retry.
if (loadErr.value && [403, 404].includes(errorInfo(loadErr.value).status)) {
  throw createError({ statusCode: 404, statusMessage: 'event_not_found', fatal: true })
}

const queue = ref<Item[]>([])
const cursor = ref<string | null>(null)
const total = ref(0)
const hiddenTotal = ref(0)
const processed = ref(0)

interface Flying { item: Item; exit: { dir: SwipeDir; vx: number; vy: number } }
const flying = ref<Flying[]>([])
const enterFrom = ref(new Map<string, SwipeDir>())

type Patch = { is_hidden?: boolean; is_highlight?: boolean }
interface HistoryEntry {
  item: Item
  dir: SwipeDir | 'unstar'
  prev: Patch
  patch: Patch | null
}
const history = ref<HistoryEntry[]>([])

// Remember what was decided this session so a refill page can't bring
// a card back (a "kept" item stays in the visible filter).
const decided = new Set<string>()

function resetFrom(page: Page | null | undefined) {
  queue.value = page?.items ?? []
  cursor.value = page?.next ?? null
  if (page?.counts) {
    total.value = tab.value === 'hidden' ? page.counts.hidden : page.counts.visible
    hiddenTotal.value = page.counts.hidden
  }
  processed.value = 0
  flying.value = []
  history.value = []
  enterFrom.value.clear()
  decided.clear()
}
resetFrom(firstPage.value)
watch(firstPage, (page) => resetFrom(page))

const refilling = ref(false)
async function refill() {
  if (refilling.value || !cursor.value || queue.value.length > 8) return
  refilling.value = true
  const forTab = tab.value
  try {
    const page = await $fetch<Page>(`/api/couple/event/${id}/photos`, {
      query: { filter: forTab === 'hidden' ? 'hidden' : 'visible', cursor: cursor.value, limit: PAGE_SIZE },
    })
    if (forTab !== tab.value) return
    const have = new Set(queue.value.map((q) => q.id))
    queue.value.push(...page.items.filter((p) => !have.has(p.id) && !decided.has(p.id)))
    cursor.value = page.next
  } catch (e) {
    toast.error(errMsg(e))
  } finally {
    refilling.value = false
  }
}
watch(() => queue.value.length, () => { refill() })

// Warm the browser cache for the card after the peek.
watch(() => queue.value[2], (it) => {
  if (import.meta.client && it?.media_type === 'photo' && it.url) new Image().src = it.url
})

const current = computed(() => queue.value[0] ?? null)
const progress = computed(() => total.value === 0 ? 0 : Math.min(1, processed.value / total.value))

// Top + peek from the queue, plus cards still flying off.
const stack = computed(() => [
  ...queue.value.slice(0, 2).map((item, i) => ({ item, state: (i === 0 ? 'top' : 'peek') as 'top' | 'peek', exit: null })),
  ...flying.value.map((f) => ({ item: f.item, state: 'flying' as const, exit: f.exit })),
])

// Cards mounted after the first paint fade in instead of popping.
const hydrated = ref(false)
onMounted(() => { hydrated.value = true })

// ─── Server writes ───────────────────────────────────────────────────
const chains = new Map<string, Promise<unknown>>()
function send(photoId: string, body: Patch) {
  const prev = chains.get(photoId) ?? Promise.resolve()
  const p = prev.catch(() => {}).then(() =>
    $fetch(`/api/couple/photo/${photoId}`, { method: 'PATCH', body }),
  )
  chains.set(photoId, p)
  p.finally(() => { if (chains.get(photoId) === p) chains.delete(photoId) }).catch(() => {})
  return p
}

function patchFor(dir: SwipeDir, item: Item): Patch | null {
  if (tab.value === 'hidden') {
    if (dir === 'right') return { is_hidden: false }
    if (dir === 'up') return { is_hidden: false, is_highlight: true }
    return null // leave hidden
  }
  if (dir === 'left') return { is_hidden: true }
  if (dir === 'up') return item.is_highlight ? null : { is_highlight: true }
  // Keep ⇒ make sure it is visible.
  return item.is_hidden ? { is_hidden: false } : null
}

function revertOf(entry: HistoryEntry): Patch | null {
  if (!entry.patch) return null
  const r: Patch = {}
  if (entry.patch.is_hidden !== undefined) r.is_hidden = entry.prev.is_hidden
  if (entry.patch.is_highlight !== undefined) r.is_highlight = entry.prev.is_highlight
  return r
}

function decide(dir: SwipeDir, v = { vx: 0, vy: 0 }) {
  const item = current.value
  if (!item) return
  // Buttons and keys throw the card with a little velocity of their own.
  const exit = {
    dir,
    vx: v.vx || (dir === 'left' ? -900 : dir === 'right' ? 900 : 0),
    vy: v.vy || (dir === 'up' ? -900 : 0),
  }
  const patch = patchFor(dir, item)
  const entry: HistoryEntry = {
    item,
    dir,
    prev: { is_hidden: item.is_hidden, is_highlight: item.is_highlight },
    patch,
  }
  queue.value = queue.value.slice(1)
  flying.value = [...flying.value.filter((f) => f.item.id !== item.id), { item, exit }]
  history.value = [...history.value.slice(-49), entry]
  enterFrom.value.delete(item.id)
  decided.add(item.id)
  processed.value += 1
  if (!patch) return
  Object.assign(item, patch)
  if (patch.is_hidden !== undefined) hiddenTotal.value += patch.is_hidden ? 1 : -1
  send(item.id, patch).catch((e) => {
    toast.error(errMsg(e))
    // Undo locally only if this decision is still on the stack.
    if (history.value.includes(entry)) rollback(entry)
  })
}

function rollback(entry: HistoryEntry) {
  history.value = history.value.filter((h) => h !== entry)
  Object.assign(entry.item, entry.prev)
  if (entry.patch?.is_hidden !== undefined) hiddenTotal.value += entry.patch.is_hidden ? -1 : 1
  if (entry.dir === 'unstar') return
  flying.value = flying.value.filter((f) => f.item.id !== entry.item.id)
  queue.value = [entry.item, ...queue.value.filter((q) => q.id !== entry.item.id)]
  enterFrom.value.set(entry.item.id, entry.dir)
  decided.delete(entry.item.id)
  processed.value = Math.max(0, processed.value - 1)
}

function undo() {
  const entry = history.value[history.value.length - 1]
  if (!entry) return
  const revert = revertOf(entry)
  rollback(entry)
  if (revert) send(entry.item.id, revert).catch((e) => toast.error(errMsg(e)))
}

// ★ on a card that already is a highlight removes the star in place.
function star() {
  const item = current.value
  if (!item) return
  if (tab.value === 'review' && item.is_highlight) {
    const entry: HistoryEntry = { item, dir: 'unstar', prev: { is_highlight: true }, patch: { is_highlight: false } }
    history.value = [...history.value.slice(-49), entry]
    item.is_highlight = false
    send(item.id, { is_highlight: false }).catch((e) => {
      toast.error(errMsg(e))
      if (history.value.includes(entry)) rollback(entry)
    })
    return
  }
  decide('up')
}

function onGone(photoId: string) {
  flying.value = flying.value.filter((f) => f.item.id !== photoId)
}

// ─── Keyboard ────────────────────────────────────────────────────────
// ←/→ decide, ↑ / Space / Enter star, ⌘Z / Ctrl+Z undo.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.defaultPrevented || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"]')) return
  if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    undo()
    return
  }
  if (e.metaKey || e.ctrlKey || e.repeat || !current.value) return
  // Space / Enter on a focused button or link keep their own meaning.
  const onControl = !!target?.closest('button, a, [role="button"]')
  if (e.key === 'ArrowLeft') { e.preventDefault(); decide('left') }
  else if (e.key === 'ArrowRight') { e.preventDefault(); decide('right') }
  else if (e.key === 'ArrowUp' || ((e.key === ' ' || e.key === 'Enter') && !onControl)) {
    e.preventDefault()
    star()
  }
})

const tabs = computed(() => [
  { key: 'review' as const, label: t('couple.moderate.tabReview') },
  { key: 'hidden' as const, label: t('couple.moderate.tabHidden', { n: hiddenTotal.value }) },
])
const tagLeft = computed(() => tab.value === 'hidden' ? t('couple.moderate.tagSkip') : t('couple.moderate.tagHide'))
const tagRight = computed(() => tab.value === 'hidden' ? t('couple.moderate.tagRestore') : t('couple.moderate.tagKeep'))
const spring = computed(() => reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.35 })
const roundBtn = 'grid place-items-center rounded-full bg-white shadow-md transition-transform duration-150 hover:scale-105 active:scale-90 disabled:opacity-40 disabled:active:scale-100'
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <NuxtLink
      :to="localePath(`/dashboard/event/${id}`)"
      class="mb-3 inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
    >
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {{ t('couple.event.backToEvent') }}
    </NuxtLink>

    <div class="mb-4 flex items-end justify-between gap-4 [@media(max-height:700px)]:mb-3">
      <div class="min-w-0">
        <h1 class="heading-display-md">{{ t('couple.moderate.title') }}</h1>
        <p class="mt-1 text-sm text-(--color-muted-foreground)">
          {{ tab === 'hidden' ? t('couple.moderate.descHidden') : t('couple.moderate.desc') }}
        </p>
      </div>
      <div class="shrink-0 text-right">
        <p class="font-display text-2xl tabular-nums">{{ processed }} / {{ total }}</p>
        <p class="text-[10px] uppercase tracking-widest text-(--color-muted-foreground)">{{ t('couple.moderate.processed') }}</p>
      </div>
    </div>

    <!-- Tabs: review ↔ hidden. The pill slides with a spring. -->
    <div class="relative mb-4 grid grid-cols-2 rounded-full border border-(--color-border) bg-white p-1 [@media(max-height:700px)]:mb-3" role="tablist">
      <motion.div
        aria-hidden="true"
        class="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-(--color-primary)"
        :initial="false"
        :animate="{ x: tab === 'hidden' ? '100%' : '0%' }"
        :transition="spring"
      />
      <button
        v-for="tb in tabs"
        :key="tb.key"
        type="button"
        role="tab"
        :aria-selected="tab === tb.key"
        class="relative z-10 h-9 rounded-full text-sm transition-colors duration-200 active:scale-[0.98]"
        :class="tab === tb.key ? 'text-(--color-primary-foreground)' : 'text-(--color-muted-foreground) hover:text-(--color-foreground)'"
        @click="tab = tb.key"
      >{{ tb.label }}</button>
    </div>

    <!-- Progress bar (transform only) -->
    <div class="mb-5 h-1.5 overflow-hidden rounded-full bg-(--color-muted) [@media(max-height:700px)]:mb-3">
      <div
        class="h-full origin-left rounded-full bg-(--color-primary) transition-transform duration-500 ease-out"
        :style="{ transform: `scaleX(${progress})` }"
      />
    </div>

    <!-- Load error -->
    <div v-if="loadErr && !pending" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('couple.event.loadErrorTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ errMsg(loadErr) }}</p>
      <button
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
        @click="refresh()"
      >
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <!-- Empty state -->
    <div v-else-if="total === 0 && !pending && !current" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ tab === 'hidden' ? t('couple.moderate.hiddenEmptyTitle') : t('couple.moderate.emptyTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ tab === 'hidden' ? t('couple.moderate.hiddenEmptyDesc') : t('couple.moderate.emptyDesc') }}</p>
    </div>

    <!-- All done -->
    <div v-else-if="!current && !pending && !refilling && !cursor && flying.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-(--color-primary) text-white">
        <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 class="text-xl">{{ t('couple.moderate.doneTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ t('couple.moderate.doneDesc') }}</p>
      <button
        v-if="history.length"
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-transform duration-150 hover:bg-(--color-muted) active:scale-[0.97]"
        @click="undo"
      >
        <Undo2 class="h-4 w-4" />
        {{ t('couple.moderate.undoLast') }}
      </button>
    </div>

    <!-- Card stack. Height follows the viewport so the buttons stay on screen. -->
    <div v-else class="card-stack relative mx-auto">
      <DashboardModerationCard
        v-for="c in stack"
        :key="c.item.id"
        :item="c.item"
        :state="c.state"
        :exit="c.exit"
        :enter-from="enterFrom.get(c.item.id) ?? null"
        :appear="hydrated"
        :reduce-motion="!!reduceMotion"
        :tag-left="tagLeft"
        :tag-right="tagRight"
        @swipe="decide"
        @gone="onGone(c.item.id)"
      />
    </div>

    <!-- Action buttons -->
    <div v-if="current || flying.length" class="mt-5 flex items-center justify-center gap-4 [@media(max-height:700px)]:mt-3">
      <button
        type="button"
        :aria-label="tab === 'hidden' ? t('couple.moderate.skipAria') : t('couple.moderate.hideAria')"
        :disabled="!current"
        :class="[roundBtn, 'h-14 w-14 border-2 border-red-200 text-red-500']"
        @click="decide('left')"
      >
        <EyeOff v-if="tab === 'hidden'" class="h-6 w-6" :stroke-width="2" />
        <X v-else class="h-7 w-7" :stroke-width="2.2" />
      </button>

      <button
        type="button"
        :aria-label="current?.is_highlight && tab === 'review' ? t('couple.moderate.unstarAria') : t('couple.moderate.starAria')"
        :aria-pressed="!!current?.is_highlight"
        :disabled="!current"
        :class="[
          roundBtn,
          'h-12 w-12 border-2',
          current?.is_highlight ? 'border-amber-400 bg-amber-400 text-white' : 'border-amber-200 text-amber-500',
        ]"
        @click="star"
      >
        <Star class="h-6 w-6" :class="current?.is_highlight ? 'fill-current' : ''" :stroke-width="2" />
      </button>

      <button
        type="button"
        :aria-label="t('couple.moderate.undoAria')"
        :disabled="history.length === 0"
        :class="[roundBtn, 'h-12 w-12 border border-(--color-border) text-(--color-muted-foreground) shadow-sm']"
        @click="undo"
      >
        <Undo2 class="h-5 w-5" />
      </button>

      <button
        type="button"
        :aria-label="tab === 'hidden' ? t('couple.moderate.restoreAria') : t('couple.moderate.keepAria')"
        :disabled="!current"
        :class="[roundBtn, 'h-14 w-14 border-2 border-emerald-200 text-emerald-500']"
        @click="decide('right')"
      >
        <ArchiveRestore v-if="tab === 'hidden'" class="h-6 w-6" :stroke-width="2" />
        <Heart v-else class="h-7 w-7" :stroke-width="2" />
      </button>
    </div>

    <p class="mt-5 hidden text-center text-xs text-(--color-muted-foreground) [@media(hover:hover)_and_(pointer:fine)]:block">
      {{ tab === 'hidden' ? t('couple.moderate.keysHintHidden') : t('couple.moderate.keysHint') }}
    </p>
  </div>
</template>

<style scoped>
/* 3:4 card whose height follows the viewport, so the action buttons
   stay on screen down to 640px-tall phones (iPhone SE: 667). Short
   screens also get tighter margins above, hence the smaller offset. */
.card-stack {
  --stack-h: clamp(15rem, calc(100svh - 28rem), 32rem);
  height: var(--stack-h);
  width: min(100%, calc(var(--stack-h) * 0.75));
}
@media (max-height: 700px) {
  .card-stack { --stack-h: clamp(15rem, calc(100svh - 25rem), 32rem); }
}
</style>
