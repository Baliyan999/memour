<script lang="ts">
export type SwipeDir = 'left' | 'right' | 'up'
export interface ModerationItem {
  id: string
  media_type: 'photo' | 'video' | 'voice'
  is_hidden: boolean
  is_highlight: boolean
  guest_name: string | null
  guest_table: number | null
  duration_ms: number | null
  url: string | null
  thumb_url: string | null
}
</script>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '#imports'
import { formatDuration } from '~/utils/format'
import { motion, animate, useMotionValue, useTransform } from 'motion-v'
import { Star, Play, Pause, Mic } from '@lucide/vue'

/**
 * One polaroid in the swipe-moderation stack.
 *
 * Every card owns its motion values, so a card that is still flying
 * off can never drag the next card along with it (the old shared `x`
 * let drag inertia overwrite the reset of the next card).
 *
 * Gesture model (Apple "Designing Fluid Interfaces"):
 *   - Pointer Events; pointer capture starts only after a 4px slop, so
 *     a tap on the play button stays a normal click.
 *   - 1:1 tracking from where the card was grabbed — grabbing a card
 *     mid-animation stops the spring and continues from the on-screen
 *     position.
 *   - Release velocity comes from the last ~100ms of samples; the
 *     resting point is projected with iOS's deceleration curve and the
 *     decision is taken on that projection plus the velocity sign.
 *   - Snap-back and fly-off are springs seeded with the release
 *     velocity; vertical movement rubber-bands.
 *   - Reduced motion: no fly-off or stack scaling — plain cross-fades.
 */
const props = defineProps<{
  item: ModerationItem
  state: 'top' | 'peek' | 'flying'
  /** Set when the card leaves the stack. */
  exit: { dir: SwipeDir; vx: number; vy: number } | null
  /** Coming back through undo: start off-screen on this side. */
  enterFrom: SwipeDir | null
  /** Mounted after the first paint → fade in instead of popping. */
  appear: boolean
  reduceMotion: boolean
  tagLeft: string
  tagRight: string
}>()

const emit = defineEmits<{
  (e: 'swipe', dir: SwipeDir, v: { vx: number; vy: number }): void
  (e: 'gone'): void
}>()

const { t } = useI18n()

const PEEK = { scale: 0.94, y: 12, opacity: 0.7 }

const x = useMotionValue(0)
const y = useMotionValue(0)
const scale = useMotionValue(1)
const opacity = useMotionValue(1)
const rotate = useTransform(x, [-320, 0, 320], [-14, 0, 14])
const leftTag = useTransform(x, [-140, -30, 0], [1, 0, 0])
const rightTag = useTransform(x, [0, 30, 140], [0, 0, 1])
const upTag = useTransform(y, [-160, -40, 0], [1, 0, 0])

// motion.div's template ref is the component instance; we need its node.
const el = ref<any>(null)
const node = (): HTMLElement | null => el.value?.$el ?? el.value ?? null

// Critically damped by default; a touch of bounce only after a flick.
const SETTLE = { type: 'spring' as const, bounce: 0, duration: 0.35 }
const FADE = { duration: 0.18 }

type Controls = { stop: () => void }
let running: Controls[] = []
function stopAll() {
  for (const c of running) c.stop()
  running = []
}
function run(...controls: Controls[]) {
  running.push(...controls)
}

function toTop(velocity = { vx: 0, vy: 0 }, bounce = 0) {
  stopAll()
  if (props.reduceMotion) {
    x.jump(0); y.jump(0); scale.jump(1)
    run(animate(opacity, 1, FADE))
    return
  }
  run(
    animate(x, 0, { ...SETTLE, bounce, velocity: velocity.vx }),
    animate(y, 0, { ...SETTLE, bounce, velocity: velocity.vy }),
    animate(scale, 1, SETTLE),
    animate(opacity, 1, SETTLE),
  )
}

function flyOut() {
  if (!props.exit) return
  stopAll()
  const { dir, vx, vy } = props.exit
  const done = () => emit('gone')
  if (props.reduceMotion) {
    const a = animate(opacity, 0, FADE)
    run(a)
    a.then(done)
    return
  }
  const w = node()?.offsetWidth ?? 360
  const h = node()?.offsetHeight ?? 480
  const vw = typeof window !== 'undefined' ? window.innerWidth : 800
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  // Far enough to clear the viewport from the centre, rotated.
  const tx = dir === 'left' ? -(vw / 2 + w * 1.2) : dir === 'right' ? vw / 2 + w * 1.2 : x.get()
  const ty = dir === 'up' ? -(vh / 2 + h * 1.2) : y.get() + vy * 0.08
  const spring = { type: 'spring' as const, bounce: 0, duration: 0.45 }
  const ax = animate(x, tx, { ...spring, velocity: vx })
  const ay = animate(y, ty, { ...spring, velocity: vy })
  run(ax, ay, animate(scale, 1, SETTLE), animate(opacity, 1, SETTLE))
  Promise.all([ax, ay]).then(done)
}

function toPeek(fromNothing: boolean) {
  stopAll()
  if (props.reduceMotion) {
    x.jump(0); y.jump(0); scale.jump(1)
    if (fromNothing) opacity.jump(0)
    run(animate(opacity, 1, FADE))
    return
  }
  if (fromNothing) {
    x.jump(0); y.jump(PEEK.y); scale.jump(PEEK.scale); opacity.jump(0)
  }
  run(
    animate(x, 0, SETTLE),
    animate(y, PEEK.y, SETTLE),
    animate(scale, PEEK.scale, SETTLE),
    animate(opacity, PEEK.opacity, SETTLE),
  )
}

// Initial placement.
if (props.enterFrom && !props.reduceMotion) {
  const off = 600
  if (props.enterFrom === 'left') x.jump(-off)
  else if (props.enterFrom === 'right') x.jump(off)
  else y.jump(-off)
}
if (props.state === 'peek' && !props.reduceMotion) {
  y.jump(PEEK.y); scale.jump(PEEK.scale); opacity.jump(PEEK.opacity)
}
if (props.appear) opacity.jump(0)

watch(
  () => [props.state, props.exit] as const,
  ([state, exit], old) => {
    if (exit) return flyOut()
    if (state === 'top') return toTop()
    if (state === 'peek') return toPeek(!old && props.appear)
  },
  { immediate: true },
)

// Coming back through undo while still mounted (card was mid-flight).
watch(() => props.enterFrom, (from) => {
  if (from && props.state === 'top' && !props.exit) toTop()
})

// ─── Drag ────────────────────────────────────────────────────────────
const SLOP = 4
let pointerId: number | null = null
let dragging = false
let startX = 0
let startY = 0
let grabX = 0
let grabY = 0
let samples: { t: number; x: number; y: number }[] = []
let suppressClick = false

/** Resistance past a boundary: the further, the less it follows. */
function rubberband(offset: number, dimension: number, c = 0.55) {
  const sign = Math.sign(offset)
  const d = Math.abs(offset)
  return sign * (d * dimension * c) / (dimension + c * d)
}

/** Resting point of a flick (iOS scroll deceleration). */
function project(v: number, rate = 0.998) {
  return (v / 1000) * rate / (1 - rate)
}

function onPointerDown(e: PointerEvent) {
  if (props.state !== 'top' || props.exit || pointerId !== null) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  pointerId = e.pointerId
  dragging = false
  suppressClick = false
  // Interrupt whatever is running and continue from the live value.
  stopAll()
  startX = e.clientX
  startY = e.clientY
  grabX = e.clientX - x.get()
  grabY = e.clientY - y.get()
  samples = [{ t: e.timeStamp, x: x.get(), y: y.get() }]
  // Feedback on press, not on release.
  if (!props.reduceMotion) run(animate(scale, 0.985, { type: 'spring', bounce: 0, duration: 0.2 }))
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  if (!dragging) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < SLOP) return
    dragging = true
    suppressClick = true
    try { node()?.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
  }
  const h = node()?.offsetHeight ?? 480
  x.set(e.clientX - grabX)
  y.set(rubberband(e.clientY - grabY, h))
  samples.push({ t: e.timeStamp, x: x.get(), y: y.get() })
  const cutoff = e.timeStamp - 100
  while (samples.length > 2 && samples[0]!.t < cutoff) samples.shift()
}

function velocity(now: number) {
  const first = samples[0]
  const last = samples[samples.length - 1]
  // Finger stopped before lifting → no throw.
  if (!first || !last || last === first || now - last.t > 80) return { vx: 0, vy: 0 }
  const dt = Math.max(1, last.t - first.t) / 1000
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  try { node()?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
  if (!dragging) {
    toTop()
    return
  }
  dragging = false
  const v = velocity(e.timeStamp)
  const w = node()?.offsetWidth ?? 360
  const threshold = Math.min(140, w * 0.4)
  const projected = x.get() + project(v.vx)
  // Commit on the projected resting point, but never against the
  // direction the finger was moving at release.
  if (projected < -threshold && v.vx <= 150) emit('swipe', 'left', v)
  else if (projected > threshold && v.vx >= -150) emit('swipe', 'right', v)
  else toTop(v, Math.abs(v.vx) > 400 ? 0.25 : 0)
}

function onPointerCancel(e: PointerEvent) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  dragging = false
  toTop()
}

// A drag must not also count as a tap on whatever was under the finger.
function onClickCapture(e: MouseEvent) {
  if (suppressClick) {
    e.stopPropagation()
    e.preventDefault()
    suppressClick = false
  }
}

// ─── Media ───────────────────────────────────────────────────────────
const fullLoaded = ref(false)
const fullImg = ref<HTMLImageElement | null>(null)
// An SSR-rendered image can finish loading before hydration attaches
// @load — check once mounted so it doesn't stay invisible.
onMounted(() => {
  if (fullImg.value?.complete && fullImg.value.naturalWidth > 0) fullLoaded.value = true
})
const mediaEl = ref<HTMLMediaElement | null>(null)
const playing = ref(false)
function togglePlay() {
  const m = mediaEl.value
  if (!m) return
  if (m.paused) m.play().catch(() => { playing.value = false })
  else m.pause()
}
watch(() => props.state, (s) => {
  if (s !== 'top') mediaEl.value?.pause()
})
onBeforeUnmount(() => {
  stopAll()
  mediaEl.value?.pause()
})
</script>

<template>
  <motion.div
    ref="el"
    :style="{
      x, y, rotate, scale, opacity,
      zIndex: state === 'flying' ? 30 : state === 'top' ? 20 : 10,
      touchAction: 'pan-y',
    }"
    class="absolute inset-0 select-none rounded-md bg-white p-3 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)] [-webkit-touch-callout:none]"
    :class="[
      state === 'top' && !exit ? 'cursor-grab active:cursor-grabbing' : 'pointer-events-none',
    ]"
    :aria-hidden="state !== 'top'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @click.capture="onClickCapture"
    @dragstart.prevent
  >
    <div class="relative h-full w-full overflow-hidden rounded-sm bg-(--color-muted)">
      <template v-if="item.media_type === 'photo'">
        <!-- Thumbnail paints instantly, the full photo fades in over it -->
        <img
          v-if="item.thumb_url"
          :src="item.thumb_url"
          alt=""
          draggable="false"
          class="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover blur-sm"
        >
        <img
          v-if="item.url"
          ref="fullImg"
          :src="item.url"
          alt=""
          draggable="false"
          class="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
          :class="fullLoaded ? 'opacity-100' : 'opacity-0'"
          @load="fullLoaded = true"
        >
      </template>

      <template v-else-if="item.media_type === 'video'">
        <video
          v-if="item.url"
          ref="mediaEl"
          :src="`${item.url}#t=0.1`"
          preload="metadata"
          playsinline
          loop
          class="pointer-events-none absolute inset-0 h-full w-full bg-black object-contain"
          @play="playing = true"
          @pause="playing = false"
        />
        <button
          type="button"
          class="absolute inset-0 grid place-items-center"
          :aria-label="playing ? t('couple.moderate.pause') : t('couple.moderate.play')"
          @click="togglePlay"
        >
          <span
            class="grid h-16 w-16 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity duration-200"
            :class="playing ? 'opacity-0' : 'opacity-100'"
          >
            <Play class="ml-1 h-7 w-7 fill-current" />
          </span>
        </button>
      </template>

      <div
        v-else
        class="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-(--color-accent)/60 to-(--color-rose)/30 pb-10 text-(--color-primary) [@media(max-height:700px)]:gap-3"
      >
        <audio
          v-if="item.url"
          ref="mediaEl"
          :src="item.url"
          preload="metadata"
          @play="playing = true"
          @pause="playing = false"
          @ended="playing = false"
        />
        <div class="grid h-20 w-20 place-items-center rounded-full bg-white/80 shadow-sm [@media(max-height:700px)]:h-16 [@media(max-height:700px)]:w-16">
          <Mic class="h-9 w-9" :stroke-width="1.6" />
        </div>
        <p class="text-sm text-(--color-muted-foreground)">
          {{ t('couple.moderate.voiceTitle') }}<span v-if="item.duration_ms"> · {{ formatDuration(item.duration_ms) }}</span>
        </p>
        <button
          type="button"
          class="inline-flex h-12 items-center gap-2 rounded-full bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform duration-150 active:scale-95"
          @click="togglePlay"
        >
          <Pause v-if="playing" class="h-4 w-4 fill-current" />
          <Play v-else class="h-4 w-4 fill-current" />
          {{ playing ? t('couple.moderate.pause') : t('couple.moderate.play') }}
        </button>
      </div>

      <!-- Decision tags, driven by the drag -->
      <motion.div
        :style="{ opacity: leftTag }"
        class="pointer-events-none absolute left-4 top-4 rotate-[-12deg] rounded-md border-4 border-red-500 bg-white/70 px-3 py-1.5 font-display text-xl font-semibold text-red-500 sm:text-2xl"
      >{{ tagLeft }}</motion.div>
      <motion.div
        :style="{ opacity: rightTag }"
        class="pointer-events-none absolute right-4 top-4 rotate-[12deg] rounded-md border-4 border-emerald-500 bg-white/70 px-3 py-1.5 font-display text-xl font-semibold text-emerald-600 sm:text-2xl"
      >{{ tagRight }}</motion.div>
      <motion.div
        :style="{ opacity: upTag }"
        class="pointer-events-none absolute inset-x-0 top-1/3 mx-auto grid h-20 w-20 place-items-center rounded-full bg-amber-400 text-white shadow-lg"
      >
        <Star class="h-10 w-10 fill-current" />
      </motion.div>

      <!-- Highlight star indicator if already highlighted -->
      <div
        v-if="item.is_highlight"
        class="pointer-events-none absolute bottom-16 right-3 grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-white shadow-md"
      >
        <Star class="h-5 w-5 fill-current" />
      </div>

      <!-- Bottom caption -->
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 pb-4 pt-10"
        :class="item.media_type === 'voice' ? 'text-(--color-foreground)' : 'bg-gradient-to-t from-black/70 to-transparent text-white'"
      >
        <p class="text-sm">
          <span v-if="item.guest_name">{{ t('couple.moderate.fromGuest', { name: item.guest_name }) }}</span>
          <span v-else class="opacity-70">{{ t('couple.moderate.guestAnon') }}</span>
          <span v-if="item.guest_table"> · {{ t('couple.moderate.tableSuffix', { n: item.guest_table }) }}</span>
        </p>
      </div>
    </div>
  </motion.div>
</template>
