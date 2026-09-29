<script setup lang="ts">
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { useFullscreen, useIdle, useWakeLock } from '@vueuse/core'
import { Maximize2, Minimize2, Volume2, VolumeX } from '@lucide/vue'
import { useI18n } from '#imports'
import { useLiveFeed, type LiveFeedResponse, type LiveItem } from '~/composables/useLiveFeed'

definePageMeta({ layout: 'guest' })

/**
 * /e/[id]/live — live slideshow projected onto the hall screen.
 *
 *   • Polls /api/guest/live-init (see useLiveFeed) — works for an
 *     anonymous projector, backfills after network drops, and drops
 *     items the couple hides.
 *   • Center stage: new uploads first (in arrival order), then a fair
 *     rotation through everything the feed has served — least recently
 *     shown first.
 *   • Each next item is mounted invisibly and revealed only once it's
 *     decoded / has its first frame, then cross-fades in.
 *   • Background mosaic shows the latest 12 photos as polaroids.
 *   • Keeps the screen awake; fullscreen + sound controls hide with
 *     the cursor after a few idle seconds.
 *
 * The slideshow is anonymous: anyone with the URL can watch while the
 * event is active. The link is shared by the couple via dashboard.
 * UUIDs are unguessable. It is part of Pro and up: on Basic the feed
 * answers not_in_plan and the page says where the slideshow starts
 * (and checks back, so an upgrade starts it).
 */
const route = useRoute()
const eventId = computed(() => route.params.id as string)
const { t } = useI18n()
const reduce = useReducedMotion()

// Initial load (SSR): event name + newest items, so the first frame
// needs no extra round-trip. Polling takes over after mount.
const { data: initial, error: initialError } = await useFetch<LiveFeedResponse>(
  `/api/guest/live-init/${eventId.value}`,
)

const { items, hidden, total, coupleNames, connection, closed } = useLiveFeed(eventId.value, {
  initial: initial.value ?? null,
  initialError: initialError.value,
  onFresh,
  onHide,
})

if (import.meta.server && (closed.value === 'not_found' || closed.value === 'archived')) {
  setResponseStatus(useRequestEvent()!, closed.value === 'not_found' ? 404 : 410)
}

// --- Stage -----------------------------------------------------------

const DWELL_MS = 7_000
// While new uploads are waiting, each frame gets a bit less time.
const BUSY_DWELL_MS = 5_000
// A new upload replaces the frame on stage once it has been up this long:
const MIN_FRESH_MS = 5_000 // …if that frame is itself a new upload
const MIN_ROTATION_MS = 3_000 // …if it's an older item coming around again
// New uploads wait in line at most this deep. After a Wi-Fi drop (or a
// burst at the first dance) the backlog would otherwise queue 5 s per
// item and a photo taken right now would wait a minute behind it. What
// overflows isn't lost: never-shown items come first in the rotation.
const FRESH_MAX = 3
// Start loading the next item this long before it's due.
const PRELOAD_LEAD_MS = 3_000
// Slow venue Wi-Fi isn't a failure — the current frame just stays up
// longer. Only a load that never finishes gets skipped.
const READY_TIMEOUT_MS = 45_000
const FAILED_RETRY_MS = 60_000
const IDLE_RECHECK_MS = 2_000

interface Slide {
  key: number
  item: LiveItem
  fresh: boolean
  shown: boolean
  ready: boolean
}

/** What's mounted on stage: the current slide and/or the one preloading behind it. */
const slides = shallowRef<Slide[]>([])
let current: Slide | null = null
let pending: Slide | null = null
let shownAt = 0
let due = 0 // when the current slide may be replaced
let keySeq = 0
let showSeq = 0
const lastShown = new Map<string, number>()
const failedUntil = new Map<string, number>()
let fresh: LiveItem[] = []
let stageTimer: ReturnType<typeof setTimeout> | undefined
let readyTimer: ReturnType<typeof setTimeout> | undefined

const sound = ref(false)

function playable(it: LiveItem, now: number) {
  return !hidden.value.has(it.id) && (failedUntil.get(it.id) ?? 0) <= now
}

/** New uploads first (FIFO); otherwise the least recently shown item, newest first on ties. */
function pickNext(): { item: LiveItem; fresh: boolean } | null {
  const now = Date.now()
  const skip = current?.item.id
  while (fresh.length) {
    const it = fresh.shift()!
    if (it.id !== skip && playable(it, now)) return { item: it, fresh: true }
  }
  let best: LiveItem | null = null
  let bestSeq = Infinity
  for (const it of items.value) {
    if (it.id === skip || !playable(it, now)) continue
    const s = lastShown.get(it.id) ?? -1
    if (s < bestSeq) {
      best = it
      bestSeq = s
    }
  }
  return best ? { item: best, fresh: false } : null
}

function dwellFor(s: Slide): number {
  const ms = s.item.duration_ms
  // Video (and voice with sound on) move on at `ended`; this is only
  // the safety net if that event never comes.
  if (s.item.media_type === 'video') return Math.min(35_000, Math.max(4_000, (ms ?? 15_000) + 1_500))
  if (s.item.media_type === 'voice' && sound.value) return Math.min(65_000, Math.max(4_000, (ms ?? 30_000) + 1_500))
  return fresh.length ? BUSY_DWELL_MS : DWELL_MS
}

function setSlides() {
  const list: Slide[] = []
  if (current) list.push(current)
  if (pending) list.push(pending)
  slides.value = list
}

function prepare(): boolean {
  const next = pickNext()
  if (!next) return false
  pending = { key: ++keySeq, item: next.item, fresh: next.fresh, shown: false, ready: false }
  setSlides()
  const key = pending.key
  clearTimeout(readyTimer)
  readyTimer = setTimeout(() => onFailed(key), READY_TIMEOUT_MS)
  return true
}

function cancelPending() {
  if (!pending) return
  clearTimeout(readyTimer)
  pending = null
  setSlides()
}

function commit() {
  const s = { ...pending!, shown: true }
  pending = null
  current = s
  lastShown.set(s.item.id, ++showSeq)
  shownAt = Date.now()
  due = shownAt + dwellFor(s)
  setSlides()
}

/** Single driver: preload ahead of time, reveal when ready and due. */
function schedule() {
  clearTimeout(stageTimer)
  stageTimer = undefined
  if (closed.value) return
  const now = Date.now()
  if (!pending) {
    const at = current ? due - PRELOAD_LEAD_MS : now
    if (at > now) {
      stageTimer = setTimeout(schedule, at - now)
      return
    }
    if (!prepare()) {
      // Nothing else to show — keep the current frame and look again.
      stageTimer = setTimeout(schedule, IDLE_RECHECK_MS)
      return
    }
  }
  if (!pending!.ready) return // onReady() calls back in
  if (current && now < due) {
    stageTimer = setTimeout(schedule, due - now)
    return
  }
  commit()
  schedule()
}

function onReady(key: number) {
  if (pending?.key !== key) return
  clearTimeout(readyTimer)
  pending.ready = true
  schedule()
}

function onFailed(key: number) {
  const now = Date.now()
  if (pending?.key === key) {
    failedUntil.set(pending.item.id, now + FAILED_RETRY_MS)
    cancelPending()
    schedule()
  } else if (current?.key === key) {
    // Broke mid-play (e.g. a clip that won't decode): move on.
    failedUntil.set(current.item.id, now + FAILED_RETRY_MS)
    onEnded(key)
  }
}

function onEnded(key: number) {
  if (current?.key !== key) return
  due = Math.min(due, Date.now())
  schedule()
}

function onFresh(list: LiveItem[]) {
  fresh.push(...[...list].sort((a, b) => Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at)))
  if (fresh.length > FRESH_MAX) fresh.splice(0, fresh.length - FRESH_MAX)
  // A rotation item preloading behind the stage yields to the new upload.
  if (pending && !pending.fresh) cancelPending()
  // Shorten the current frame — unless it's a new clip still playing.
  if (current && !(current.fresh && current.item.media_type !== 'photo')) {
    due = Math.min(due, shownAt + (current.fresh ? MIN_FRESH_MS : MIN_ROTATION_MS))
  }
  schedule()
}

function onHide(ids: string[]) {
  const gone = new Set(ids)
  fresh = fresh.filter((it) => !gone.has(it.id))
  if (pending && gone.has(pending.item.id)) cancelPending()
  if (current && gone.has(current.item.id)) {
    // Off the screen right away — don't wait for the next frame.
    current = null
    setSlides()
  }
  schedule()
}

watch(sound, (on) => {
  // Voice on stage: with sound it plays from the start to the end,
  // without it's a normal frame again.
  if (current?.item.media_type === 'voice') {
    due = (on ? Date.now() : shownAt) + dwellFor(current)
    schedule()
  }
})

watch(closed, (c) => {
  if (c) {
    clearTimeout(stageTimer)
    cancelPending()
    current = null
    setSlides()
  } else {
    schedule()
  }
})

const spring = { type: 'spring', bounce: 0, visualDuration: 0.4 } as const
const fade = { duration: 0.2, ease: 'linear' } as const
const stageTransition = computed(() => (reduce.value ? fade : spring))
const slideHidden = computed(() => (reduce.value ? { opacity: 0, scale: 1 } : { opacity: 0, scale: 0.97 }))
const slideShown = { opacity: 1, scale: 1 }

// --- Mosaic ----------------------------------------------------------

const MOSAIC_SIZE = 12
const mosaic = computed(() => {
  const out: LiveItem[] = []
  for (const it of items.value) {
    // Only photos have thumbnails.
    if (it.media_type !== 'photo' || hidden.value.has(it.id)) continue
    out.push(it)
    if (out.length === MOSAIC_SIZE) break
  }
  return out
})

// Pseudo-random offsets per photo for the background mosaic so it
// feels organic instead of grid-aligned. Derived from the id only, so a
// tile keeps its tilt when newer photos push it along. Applied to an
// inner element: motion owns the outer transform.
const mosaicStyle = (id: string) => {
  let seed = 0
  for (let i = 0; i < 8; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0
  const rot = ((seed % 17) - 8) * 0.6
  const ty = ((seed >>> 5) % 13) - 6
  const tx = ((seed >>> 9) % 13) - 6
  return { transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)` }
}

// --- Projector chrome --------------------------------------------------

const { idle } = useIdle(3_000)
const { isSupported: canFullscreen, isFullscreen, toggle: toggleFullscreen } = useFullscreen()

// Projector laptops blank the display after a few idle minutes. Some
// browsers only grant the lock after a user gesture — retried on the
// next click/key; VueUse re-acquires it when the tab becomes visible.
const wakeLock = useWakeLock()
async function keepAwake() {
  if (!wakeLock.isSupported.value || wakeLock.isActive.value) return
  try {
    await wakeLock.request('screen')
  } catch {
    // denied for now — next interaction tries again
  }
}

function onKey(e: KeyboardEvent) {
  void keepAwake()
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'f' || e.key === 'F') void toggleFullscreen()
  else if (e.key === 'm' || e.key === 'M') sound.value = !sound.value
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  void keepAwake()
  schedule()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearTimeout(stageTimer)
  clearTimeout(readyTimer)
})

// The global stylesheet forces a permanent scrollbar gutter on <html>,
// which shows as a light strip down the side of the black projector.
useHead({ htmlAttrs: { style: 'overflow: hidden; background: #000' } })

useSeoMeta({
  title: () => (coupleNames.value ? t('guest.live.pageTitle', { couple: coupleNames.value }) : 'Memour Live'),
})

const CLOSED_KEYS = { archived: 'archived', not_active: 'notActive', not_in_plan: 'notInPlan', not_found: 'notFound' } as const
const closedKey = computed(() => CLOSED_KEYS[closed.value ?? 'not_found'])
</script>

<template>
  <div
    class="relative min-h-[100dvh] overflow-hidden bg-black"
    :class="{ 'cursor-none': idle && !closed }"
    @pointerdown="keepAwake"
  >
    <template v-if="closed">
      <div class="relative z-10 grid min-h-[100dvh] place-items-center px-6 text-center text-white">
        <div class="max-w-xl">
          <p class="text-[10px] uppercase tracking-[0.4em] text-white/60">Memour Live</p>
          <h1 class="mt-5 font-display text-4xl italic sm:text-5xl">{{ t(`guest.live.closed.${closedKey}.title`) }}</h1>
          <p class="mt-4 text-base text-white/70 sm:text-lg">{{ t(`guest.live.closed.${closedKey}.desc`) }}</p>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Background mosaic — uses thumbnails (much smaller payload). -->
      <div aria-hidden="true" class="absolute inset-0 grid grid-cols-6 content-start gap-2 p-4 opacity-25 sm:gap-3 sm:p-6">
        <AnimatePresence mode="popLayout">
          <motion.div
            v-for="p in mosaic"
            :key="p.id"
            :layout="!reduce"
            :initial="{ opacity: 0, scale: reduce ? 1 : 0.9 }"
            :animate="{ opacity: 1, scale: 1 }"
            :exit="{ opacity: 0, scale: reduce ? 1 : 0.9 }"
            :transition="stageTransition"
            class="aspect-square"
          >
            <div class="h-full w-full overflow-hidden rounded-md" :style="mosaicStyle(p.id)">
              <img
                :src="`/api/photo/${p.id}?t=thumb`"
                alt=""
                class="h-full w-full object-cover"
                decoding="async"
              >
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <!-- Soft vignette over mosaic -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0"
        style="background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.75) 80%);"
      />

      <!-- Center stage: current slide + the next one loading invisibly
           behind it, stacked in one grid cell so they can cross-fade. -->
      <div class="relative z-10 grid min-h-[100dvh] place-items-center px-6 py-16 sm:px-10">
        <AnimatePresence>
          <motion.div
            v-for="s in slides"
            :key="s.key"
            class="col-start-1 row-start-1"
            :class="{ 'pointer-events-none': !s.shown }"
            :aria-hidden="s.shown ? undefined : 'true'"
            :initial="slideHidden"
            :animate="s.shown ? slideShown : slideHidden"
            :exit="slideHidden"
            :transition="stageTransition"
          >
            <LiveSlide
              :item="s.item"
              :active="s.shown"
              :sound="sound"
              :reduce="!!reduce"
              :dwell-ms="DWELL_MS"
              @ready="onReady(s.key)"
              @failed="onFailed(s.key)"
              @ended="onEnded(s.key)"
            />
          </motion.div>
          <motion.div
            v-if="total === 0 && slides.length === 0"
            key="empty"
            class="col-start-1 row-start-1 max-w-xl text-center text-white/70"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
            :transition="stageTransition"
          >
            <p class="font-display text-3xl italic">{{ t('guest.live.waiting') }}</p>
            <p class="mt-3 text-sm text-white/50">{{ t('guest.live.waitingHint') }}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <!-- Photo count badge + connection state -->
      <div
        class="absolute bottom-6 left-6 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-white/90 backdrop-blur"
        role="status"
      >
        <span
          class="h-2 w-2 rounded-full"
          :class="connection === 'live' ? 'bg-red-500 motion-safe:animate-pulse' : 'bg-amber-400'"
        />
        <span class="text-xs uppercase tracking-widest">
          {{ connection === 'live' ? t('guest.live.badge') : t('guest.live.reconnecting') }}
        </span>
        <span class="ml-2 text-sm tabular-nums" :aria-label="t('guest.live.total', { n: total })">{{ total }}</span>
      </div>

      <!-- Operator controls: hidden with the cursor while idle -->
      <ClientOnly>
        <motion.div
          class="absolute bottom-6 right-6 z-30 flex gap-2"
          :class="{ 'pointer-events-none': idle }"
          :initial="false"
          :animate="{ opacity: idle ? 0 : 1 }"
          :transition="stageTransition"
        >
          <motion.button
            type="button"
            class="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/60 text-white/90 backdrop-blur hover:bg-black/80"
            :while-press="{ scale: 0.92 }"
            :transition="spring"
            :aria-label="sound ? t('guest.live.soundOff') : t('guest.live.soundOn')"
            :title="sound ? t('guest.live.soundOff') : t('guest.live.soundOn')"
            :aria-pressed="sound"
            @click="sound = !sound"
          >
            <Volume2 v-if="sound" class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
            <VolumeX v-else class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
          </motion.button>
          <motion.button
            v-if="canFullscreen"
            type="button"
            class="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/60 text-white/90 backdrop-blur hover:bg-black/80"
            :while-press="{ scale: 0.92 }"
            :transition="spring"
            :aria-label="isFullscreen ? t('guest.live.fullscreenExit') : t('guest.live.fullscreenEnter')"
            :title="isFullscreen ? t('guest.live.fullscreenExit') : t('guest.live.fullscreenEnter')"
            @click="toggleFullscreen()"
          >
            <Minimize2 v-if="isFullscreen" class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
            <Maximize2 v-else class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
          </motion.button>
        </motion.div>
      </ClientOnly>
    </template>

    <!-- Corner brand -->
    <div v-if="!closed" class="absolute right-6 top-6 z-20 text-right text-white/80">
      <p class="text-[10px] uppercase tracking-[0.4em]">Memour Live</p>
      <p v-if="coupleNames" class="font-display text-xl italic">{{ coupleNames }}</p>
    </div>
  </div>
</template>
