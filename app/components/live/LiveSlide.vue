<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { motion } from 'motion-v'
import { Mic } from '@lucide/vue'
import { useI18n } from '#imports'
import { formatDuration } from '~/utils/format'
import type { LiveItem } from '~/composables/useLiveFeed'

/**
 * LiveSlide — one polaroid on the live slideshow stage.
 *
 * The page mounts a slide invisibly first and only reveals it after
 * `ready`: a photo is fetched *and* decoded, a video has its first
 * frame. That way the enter transition never plays over an empty
 * frame and the card never jumps in size once the pixels arrive.
 *
 *   • photo — slow Ken Burns drift while on stage (ambient, time-based,
 *     so a linear tween rather than a spring; off for reduced motion)
 *   • video — muted, inline, plays once from the start when it goes on
 *     stage; `ended` lets the page move on
 *   • voice — a card with the guest's name, a waveform and the length.
 *     Silent unless the operator turned sound on; then the clip plays
 *     and `ended` moves on.
 */
const props = defineProps<{
  item: LiveItem
  active: boolean
  sound: boolean
  reduce: boolean
  dwellMs: number
}>()

const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'failed'): void
  (e: 'ended'): void
}>()

const { t } = useI18n()

const src = computed(() => `/api/photo/${props.item.id}`)
const kind = computed(() =>
  props.item.media_type === 'video' ? 'video' : props.item.media_type === 'voice' ? 'voice' : 'photo',
)

const caption = computed(() => {
  const who = props.item.guest_name
    ? t('guest.live.from', { name: props.item.guest_name })
    : t('guest.live.fromAnon')
  return props.item.guest_table ? `${who} · ${t('guest.live.table', { n: props.item.guest_table })}` : who
})

const imgEl = ref<HTMLImageElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)

const drift = computed(() => kind.value === 'photo' && props.active && !props.reduce)

// --- Voice: decorative waveform, deterministic per item so a clip
// always looks the same when it comes back around. Bars light up as
// the clip plays (opacity only).
const BARS = 48
const bars = computed(() => {
  let h = 0
  for (const ch of props.item.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0
    const envelope = Math.sin(((i + 0.5) / BARS) * Math.PI) * 0.6 + 0.4
    return Math.round((0.25 + ((h >>> 8) % 1000) / 1000 * 0.75) * envelope * 100)
  })
})
const progress = ref(0)
const duration = computed(() => formatDuration(props.item.duration_ms))
function onTime() {
  const a = audioEl.value
  if (a && a.duration > 0 && Number.isFinite(a.duration)) progress.value = a.currentTime / a.duration
}

function onVideoReady() {
  emit('ready')
}

function start() {
  if (kind.value === 'video') {
    const v = videoEl.value
    if (!v) return
    v.muted = !props.sound
    if (v.currentTime > 0) v.currentTime = 0
    v.play().catch(() => {
      // Sound needs a user gesture in some browsers — fall back to
      // muted rather than stalling the show.
      if (!v.muted) {
        v.muted = true
        v.play().catch(() => emit('ended'))
      } else {
        emit('ended')
      }
    })
  } else if (kind.value === 'voice') {
    playVoice()
  }
}

function playVoice() {
  const a = audioEl.value
  if (!a || !props.active || !props.sound) return
  progress.value = 0
  a.currentTime = 0
  // If playback is refused the card simply stays for a normal dwell.
  a.play().catch(() => {})
}

watch(() => props.active, (on) => {
  if (on) start()
})

watch(() => props.sound, async (on) => {
  if (videoEl.value) videoEl.value.muted = !on
  if (kind.value === 'voice') {
    progress.value = 0
    if (on) {
      await nextTick() // <audio> is only rendered while sound is on
      playVoice()
    }
  }
})

onMounted(async () => {
  if (kind.value === 'photo') {
    const img = imgEl.value
    if (!img) return
    try {
      await img.decode()
      emit('ready')
    } catch {
      emit('failed')
    }
  } else if (kind.value === 'video') {
    const v = videoEl.value
    // e.g. a webm recorded on Android shown on a Safari projector
    if (v && props.item.mime_type && v.canPlayType(props.item.mime_type) === '') emit('failed')
  } else {
    emit('ready')
  }
  if (props.active) start()
})

// The stage's AnimatePresence keeps the card on screen for its exit
// cross-fade after this component unmounts; this outlasts that.
const RELEASE_AFTER_EXIT_MS = 1_500

onBeforeUnmount(() => {
  // Stop at once (sound too), but keep the frame: the card is still
  // fading out, and a video without its src drops to a black 300×150
  // box. Once it's gone, detach the media so the decoder and its
  // buffers are released right away instead of whenever GC gets to the
  // element — the projector runs for hours.
  const media = [videoEl.value, audioEl.value].filter((el): el is HTMLMediaElement => !!el)
  for (const el of media) el.pause()
  if (!media.length) return
  setTimeout(() => {
    for (const el of media) {
      el.removeAttribute('src')
      el.load()
    }
  }, RELEASE_AFTER_EXIT_MS)
})
</script>

<template>
  <figure class="max-w-[min(88vw,1600px)] overflow-hidden rounded-lg bg-white p-3 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.6)]">
    <div v-if="kind === 'photo'" class="overflow-hidden rounded-md">
      <motion.div
        :initial="false"
        :animate="{ scale: drift ? 1.04 : 1 }"
        :transition="drift ? { duration: dwellMs / 1000 + 1, ease: 'linear' } : { duration: 0 }"
      >
        <img
          ref="imgEl"
          :src="src"
          :alt="caption"
          class="block h-auto max-h-[calc(100dvh-15rem)] w-auto max-w-full"
          decoding="async"
          @error="emit('failed')"
        >
      </motion.div>
    </div>

    <div v-else-if="kind === 'video'" class="overflow-hidden rounded-md bg-black">
      <video
        ref="videoEl"
        :src="src"
        class="block h-auto max-h-[calc(100dvh-15rem)] w-auto max-w-full"
        muted
        playsinline
        preload="auto"
        disablepictureinpicture
        :aria-label="caption"
        @loadeddata="onVideoReady"
        @error="emit('failed')"
        @ended="emit('ended')"
      />
    </div>

    <div
      v-else
      class="relative flex aspect-[4/3] w-[min(80vw,720px,calc((100dvh-15rem)*4/3))] flex-col items-center justify-center gap-[6%] rounded-md bg-[linear-gradient(160deg,var(--color-champagne),var(--color-rose))] px-[8%] text-(--color-accent-foreground)"
    >
      <span class="grid aspect-square w-[14%] place-items-center rounded-full bg-white/70 shadow-[0_8px_24px_-8px_rgba(120,70,40,0.45)]">
        <Mic class="h-1/2 w-1/2" :stroke-width="1.6" aria-hidden="true" />
      </span>
      <div class="flex h-[26%] w-full items-center gap-[0.6%]" aria-hidden="true">
        <span
          v-for="(hgt, i) in bars"
          :key="i"
          class="flex-1 rounded-full bg-(--color-accent-foreground) transition-opacity duration-300"
          :style="{ height: `${hgt}%`, opacity: sound && progress * BARS > i ? 0.9 : 0.35 }"
        />
      </div>
      <p class="text-center">
        <span class="block text-[clamp(0.65rem,1.4vw,0.8rem)] uppercase tracking-[0.35em] opacity-70">{{ t('guest.live.voice') }}</span>
        <span v-if="duration" class="mt-1 block font-display text-[clamp(1.25rem,3vw,2rem)] tabular-nums italic">{{ duration }}</span>
      </p>
      <audio
        v-if="sound"
        ref="audioEl"
        :src="src"
        preload="auto"
        @timeupdate="onTime"
        @ended="emit('ended')"
      />
    </div>

    <figcaption class="px-2 pt-3 text-center font-display text-[clamp(1.1rem,1.4vw,1.6rem)] italic text-(--color-foreground)">
      {{ caption }}
    </figcaption>
  </figure>
</template>
