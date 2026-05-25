<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { Video, RefreshCw, Check, X, Square, Circle, Loader2 } from '@lucide/vue'
import { useI18n } from '#imports'

const { t, te } = useI18n()

/**
 * GuestVideo — record a short clip (3-15 sec) through MediaRecorder
 * and upload to /api/guest/upload with media_type=video.
 *
 * Recording UX: tap to start, recording auto-stops at 15s OR user
 * taps stop. Preview replay before sending. Server-side limit is
 * 30 MB which a 15s 1080p webm easily fits under.
 */
const props = defineProps<{
  eventId: string
  deviceId: string
  guestName?: string | null
  guestTable: number
  geofenceEnabled: boolean
}>()

const emit = defineEmits<{
  (
    e: 'uploaded',
    media: {
      id: string
      uploaded_at: string
      counts?: { photo_count: number; video_count: number; voice_count: number }
    },
  ): void
  (e: 'quota_exceeded'): void
  (e: 'wrong_table'): void
}>()

const MIN_MS = 3000
const MAX_MS = 15000

type State = 'idle' | 'live' | 'recording' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
const error = ref<string | null>(null)

const videoEl = ref<HTMLVideoElement | null>(null)
const previewEl = ref<HTMLVideoElement | null>(null)
const stream = ref<MediaStream | null>(null)
const recorder = ref<MediaRecorder | null>(null)
const chunks = ref<Blob[]>([])
const previewUrl = ref<string | null>(null)
const lastBlob = ref<Blob | null>(null)
const lastMime = ref<string>('video/webm')
const elapsedMs = ref(0)
const facing = ref<'environment' | 'user'>('user')

let timer: number | undefined
let timeoutId: number | undefined

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return 'video/webm'
}

async function startCamera() {
  error.value = null
  try {
    if (stream.value) stream.value.getTracks().forEach((t) => t.stop())
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing.value }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    })
    stream.value = s
    state.value = 'live'
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = s
      videoEl.value.muted = true
      await videoEl.value.play().catch(() => {})
    }
  } catch (e: any) {
    state.value = 'error'
    error.value = e?.name === 'NotAllowedError' ? 'permission_denied' : 'camera_unavailable'
  }
}

function flip() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment'
  startCamera()
}

function startRecording() {
  if (!stream.value) return
  chunks.value = []
  lastMime.value = pickMime()
  const rec = new MediaRecorder(stream.value, { mimeType: lastMime.value })
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.value.push(e.data)
  }
  rec.onstop = () => {
    const blob = new Blob(chunks.value, { type: lastMime.value })
    lastBlob.value = blob
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(blob)
    state.value = 'review'
  }
  recorder.value = rec
  rec.start(100) // collect data every 100ms — smoother progress
  state.value = 'recording'
  const startedAt = Date.now()
  timer = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt
  }, 80) as unknown as number
  // Auto-stop at MAX_MS
  timeoutId = window.setTimeout(() => stopRecording(), MAX_MS) as unknown as number
}

function stopRecording() {
  if (timer) clearInterval(timer)
  if (timeoutId) clearTimeout(timeoutId)
  if (recorder.value && recorder.value.state !== 'inactive') {
    recorder.value.stop()
  }
}

function retake() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  lastBlob.value = null
  elapsedMs.value = 0
  state.value = 'live'
}

async function getLocation(): Promise<GeolocationCoordinates | null> {
  if (!props.geofenceEnabled || typeof navigator === 'undefined' || !('geolocation' in navigator)) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      { timeout: 4000, enableHighAccuracy: false },
    )
  })
}

async function send() {
  if (!lastBlob.value) return
  if (elapsedMs.value < MIN_MS) {
    error.value = 'too_short'
    return
  }
  state.value = 'uploading'
  error.value = null
  try {
    const ext = lastMime.value.includes('mp4') ? 'mp4' : 'webm'
    const coords = await getLocation()
    const fd = new FormData()
    fd.append('event_id', props.eventId)
    fd.append('device_id', props.deviceId)
    fd.append('guest_table', String(props.guestTable))
    fd.append('media_type', 'video')
    fd.append('duration_ms', String(elapsedMs.value))
    fd.append('file', new File([lastBlob.value], `clip.${ext}`, { type: lastMime.value }))
    if (props.guestName) fd.append('guest_name', props.guestName)
    if (coords) {
      fd.append('guest_lat', String(coords.latitude))
      fd.append('guest_lng', String(coords.longitude))
    }
    const res = await $fetch<{
      ok: boolean
      photo_id: string
      uploaded_at: string
      counts: { photo_count: number; video_count: number; voice_count: number }
    }>(
      '/api/guest/upload',
      { method: 'POST', body: fd },
    )
    emit('uploaded', {
      id: res.photo_id,
      uploaded_at: res.uploaded_at,
      counts: res.counts,
    })
    retake()
    state.value = 'live'
  } catch (e: any) {
    state.value = 'review'
    const code = e?.data?.data?.code ?? e?.data?.code ?? 'upload_failed'
    error.value = code
    if (code === 'quota_exceeded') emit('quota_exceeded')
    if (code === 'wrong_table') emit('wrong_table')
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (timeoutId) clearTimeout(timeoutId)
  if (recorder.value && recorder.value.state !== 'inactive') recorder.value.stop()
  if (stream.value) stream.value.getTracks().forEach((t) => t.stop())
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

const recordProgress = computed(() => Math.min(100, (elapsedMs.value / MAX_MS) * 100))
const seconds = computed(() => (elapsedMs.value / 1000).toFixed(1))

const errorMessage = computed(() => {
  if (!error.value) return null
  const code = error.value
  // too_short carries a duration parameter; resolve it through the
  // pluralised key with the seconds we care about.
  if (code === 'too_short') {
    return t('guest.errors.too_short', { sec: MIN_MS / 1000 })
  }
  // Kind-specific override first (e.g. unsupported_mime_video), then
  // the generic code, then a fallback.
  const kindKey = `guest.errors.${code}_video`
  if (te(kindKey)) return t(kindKey)
  const baseKey = `guest.errors.${code}`
  if (te(baseKey)) return t(baseKey)
  // Permission denied for video needs cam+mic copy, not photo-only.
  if (code === 'permission_denied') return t('guest.errors.permission_denied_mic')
  return t('guest.camera.genericError')
})
</script>

<template>
  <div class="relative">
    <!-- IDLE -->
    <div v-if="state === 'idle'" class="grid place-items-center p-6">
      <button
        type="button"
        class="inline-flex h-14 items-center gap-2 rounded-full bg-(--color-primary) px-8 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90"
        @click="startCamera"
      >
        <Video class="h-5 w-5" :stroke-width="1.8" />
        {{ t('guest.camera.recordVideo') }}
      </button>
      <p class="mt-3 max-w-xs text-center text-xs text-(--color-muted-foreground)">
        {{ t('guest.camera.videoHint') }}
      </p>
    </div>

    <!-- Live / recording / review -->
    <div
      v-else-if="state !== 'error'"
      class="relative overflow-hidden rounded-(--radius-xl) border border-(--color-border)/60 bg-black"
      style="aspect-ratio: 3/4"
    >
      <video
        v-show="state === 'live' || state === 'recording'"
        ref="videoEl"
        playsinline
        muted
        autoplay
        class="h-full w-full object-cover"
      />
      <video
        v-if="state === 'review' || state === 'uploading'"
        ref="previewEl"
        :src="previewUrl ?? ''"
        playsinline
        controls
        class="h-full w-full object-contain"
      />

      <!-- Recording timer bar -->
      <div
        v-if="state === 'recording'"
        class="absolute inset-x-0 top-0 px-4 pt-4"
      >
        <div class="flex items-center gap-2 text-white">
          <span class="grid h-4 w-4 place-items-center rounded-full bg-red-500 animate-pulse" />
          <span class="font-mono text-sm">{{ seconds }}s</span>
          <span class="text-xs text-white/70">/ {{ MAX_MS / 1000 }}s</span>
        </div>
        <div class="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
          <div class="h-full bg-red-500 transition-all duration-100" :style="{ width: `${recordProgress}%` }" />
        </div>
      </div>

      <!-- Uploading -->
      <div v-if="state === 'uploading'" class="absolute inset-0 grid place-items-center bg-black/60 text-white">
        <Loader2 class="h-10 w-10 animate-spin" :stroke-width="1.6" />
      </div>

      <!-- Controls -->
      <div class="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-4">
        <button
          v-if="state === 'live'"
          type="button"
          aria-label="Сменить камеру"
          class="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          @click="flip"
        >
          <RefreshCw class="h-5 w-5" />
        </button>
        <button
          v-else-if="state === 'review'"
          type="button"
          class="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          @click="retake"
        >
          <X class="h-5 w-5" />
        </button>
        <div v-else />

        <div class="grid place-items-center">
          <button
            v-if="state === 'live'"
            type="button"
            aria-label="Начать запись"
            class="grid h-16 w-16 place-items-center rounded-full border-4 border-white/80 bg-red-500 shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] transition-transform active:scale-95"
            @click="startRecording"
          >
            <Circle class="h-6 w-6 text-white" fill="currentColor" />
          </button>
          <button
            v-else-if="state === 'recording'"
            type="button"
            aria-label="Остановить"
            class="grid h-16 w-16 place-items-center rounded-full border-4 border-white/80 bg-red-500 shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] transition-transform active:scale-95"
            @click="stopRecording"
          >
            <Square class="h-6 w-6 text-white" fill="currentColor" />
          </button>
          <button
            v-else-if="state === 'review'"
            type="button"
            aria-label="Отправить"
            class="grid h-16 w-16 place-items-center rounded-full bg-(--color-primary) text-white shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] transition-transform active:scale-95"
            @click="send"
          >
            <Check class="h-7 w-7" :stroke-width="2" />
          </button>
          <div v-else class="h-16 w-16" />
        </div>

        <div />
      </div>
    </div>

    <!-- Error -->
    <div v-else class="surface-card rounded-(--radius-xl) p-6 text-center">
      <p class="font-medium text-red-700">{{ errorMessage }}</p>
      <button
        type="button"
        class="mt-4 inline-flex h-11 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-white hover:opacity-90"
        @click="startCamera"
      >{{ t('guest.camera.tryAgain') }}</button>
    </div>

    <p
      v-if="errorMessage && state !== 'error'"
      class="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >{{ errorMessage }}</p>
  </div>
</template>
