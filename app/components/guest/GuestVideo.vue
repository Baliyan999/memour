<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch, nextTick } from 'vue'
import { motion, useReducedMotion } from 'motion-v'
import { Video, RefreshCw, Check, X, Square, Circle, Loader2, Maximize2, Minimize2, Play } from '@lucide/vue'
import { useI18n } from '#imports'

const { t } = useI18n()
const haptic = useHaptic()
const { isFull, toggle: toggleFullscreen, exit: exitFullscreen } = useFullscreen()
const viewportEl = ref<HTMLElement | null>(null)
function tapFullscreen() {
  if (viewportEl.value) toggleFullscreen(viewportEl.value)
}

/**
 * GuestVideo — record a short clip (3-15 sec) through MediaRecorder
 * and upload to /api/guest/upload with media_type=video.
 *
 * Recording UX: tap to start, recording auto-stops at 15s OR user
 * taps stop. Preview replay before sending. The bitrate is capped so
 * a full 15 s clip is ~4 MB — quick on venue Wi-Fi and well under
 * the server's 30 MB limit.
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
  (e: 'rejected', code: string): void
  (e: 'busy', busy: boolean): void
}>()

const MIN_MS = 3000
const MAX_MS = 15000
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
]

type State = 'idle' | 'starting' | 'live' | 'recording' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
const cameraIssue = ref<string | null>(null)
const error = ref<string | null>(null)
const uploadPercent = ref(0)
const retryAttempt = ref(0)

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
let uploadId = ''
let uploadAbort: AbortController | null = null
let disposed = false
// Bumped per startCamera(): a double tap on "flip" starts two requests,
// and only the newest may keep its stream (the other would stay lit).
let cameraRequest = 0

let timer: number | undefined
let timeoutId: number | undefined

const location = useGuestLocation(() => props.geofenceEnabled)
const messageFor = useGuestErrorMessage('video')
const inApp = isInAppBrowser()
const reduceMotion = useReducedMotion()
const spring = computed(() => (reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.35 }))

watch(state, (s) => {
  emit('busy', s === 'recording' || s === 'review' || s === 'uploading')
  if ((s === 'idle' || s === 'error') && isFull.value) void exitFullscreen()
})

function stopStream() {
  if (stream.value) {
    stream.value.getTracks().forEach((t) => t.stop())
    stream.value = null
  }
}

async function startCamera() {
  error.value = null
  cameraIssue.value = captureSupportIssue()
    ?? (typeof MediaRecorder === 'undefined' ? 'recorder_unsupported' : null)
  if (cameraIssue.value) {
    state.value = 'error'
    return
  }
  state.value = 'starting'
  const request = ++cameraRequest
  try {
    stopStream()
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing.value }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    })
    if (disposed || request !== cameraRequest) {
      s.getTracks().forEach((t) => t.stop())
      return
    }
    stream.value = s
    await nextTick()
    const video = videoEl.value
    if (!video) throw new Error('no video element')
    video.srcObject = s
    video.muted = true
    await video.play().catch(() => {})
    if (!(await waitForFirstFrame(video))) throw Object.assign(new Error('no frames'), { name: 'NotReadableError' })
    if (state.value === 'starting' && request === cameraRequest) state.value = 'live'
  } catch (e) {
    if (disposed || request !== cameraRequest) return
    stopStream()
    state.value = 'error'
    cameraIssue.value = mediaErrorCode(e, 'camera')
  }
}

function flip() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment'
  startCamera()
}

function startRecording() {
  if (!stream.value || state.value !== 'live') return
  // ~2 Mbps: a 15 s 720p clip lands around 4 MB instead of whatever
  // the browser default is (iOS goes well past 10 MB).
  const rec = createRecorder(stream.value, MIME_CANDIDATES, {
    videoBitsPerSecond: 2_000_000,
    audioBitsPerSecond: 96_000,
  })
  if (!rec) {
    error.value = 'recorder_unsupported'
    haptic.error()
    return
  }
  haptic.tap()
  location.prime()
  error.value = null
  chunks.value = []
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.value.push(e.data)
  }
  rec.onstop = () => {
    if (disposed) return
    lastMime.value = rec.mimeType || chunks.value[0]?.type || 'video/webm'
    const blob = new Blob(chunks.value, { type: lastMime.value })
    lastBlob.value = blob
    uploadId = randomUuid()
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(blob)
    reviewSince = performance.now()
    state.value = 'review'
  }
  try {
    rec.start(100) // collect data every 100ms — smoother progress
  } catch {
    error.value = 'recorder_unsupported'
    haptic.error()
    return
  }
  recorder.value = rec
  state.value = 'recording'
  const startedAt = Date.now()
  elapsedMs.value = 0
  timer = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt
  }, 80) as unknown as number
  // Auto-stop at MAX_MS
  timeoutId = window.setTimeout(() => stopRecording(), MAX_MS) as unknown as number
}

function stopRecording() {
  haptic.tap()
  if (timer) clearInterval(timer)
  if (timeoutId) clearTimeout(timeoutId)
  if (recorder.value && recorder.value.state !== 'inactive') {
    recorder.value.stop()
  }
}

const previewPlaying = ref(false)
function togglePreview() {
  const v = previewEl.value
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}

function retake() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  lastBlob.value = null
  elapsedMs.value = 0
  error.value = null
  state.value = stream.value ? 'live' : 'idle'
}

// Same guard as the photo shutter: "send" appears where "stop" was.
const REVIEW_ARM_MS = 450
let reviewSince = 0

const PAGE_CODES = new Set(['quota_exceeded', 'wrong_table', 'window_not_open', 'window_closed', 'event_not_active', 'not_in_plan', 'invalid_table', 'consent_required'])

async function send() {
  if (!lastBlob.value || state.value !== 'review') return
  if (performance.now() - reviewSince < REVIEW_ARM_MS) return
  if (elapsedMs.value < MIN_MS) {
    error.value = 'too_short'
    haptic.error()
    return
  }
  haptic.tap()
  state.value = 'uploading'
  uploadPercent.value = 0
  retryAttempt.value = 0
  error.value = null
  uploadAbort = new AbortController()
  try {
    const blob = lastBlob.value
    const ext = lastMime.value.includes('mp4') ? 'mp4' : 'webm'
    const coords = await location.get()
    if (uploadAbort.signal.aborted) throw { code: 'aborted' }
    const res = await uploadWithRetry<{
      ok: boolean
      photo_id: string
      uploaded_at: string
      counts: { photo_count: number; video_count: number; voice_count: number }
    }>(
      '/api/guest/upload',
      () => {
        const fd = new FormData()
        fd.append('event_id', props.eventId)
        fd.append('device_id', props.deviceId)
        fd.append('upload_id', uploadId)
        fd.append('guest_table', String(props.guestTable))
        fd.append('media_type', 'video')
        fd.append('duration_ms', String(Math.min(elapsedMs.value, MAX_MS)))
        fd.append('file', new File([blob], `clip.${ext}`, { type: lastMime.value }))
        if (props.guestName) fd.append('guest_name', props.guestName)
        if (coords) {
          fd.append('guest_lat', String(coords.latitude))
          fd.append('guest_lng', String(coords.longitude))
          fd.append('guest_accuracy', String(Math.round(coords.accuracy)))
        }
        return fd
      },
      {
        signal: uploadAbort.signal,
        onProgress: (pct) => { uploadPercent.value = pct },
        onRetry: (attempt) => { retryAttempt.value = attempt },
      },
    )
    if (!res.ok || !res.data) throw { code: res.error?.code ?? 'upload_failed' }
    haptic.success()
    emit('uploaded', {
      id: res.data.photo_id,
      uploaded_at: res.data.uploaded_at,
      counts: res.data.counts,
    })
    retake()
  } catch (e: any) {
    const code: string = e?.code ?? 'upload_failed'
    state.value = 'review'
    reviewSince = 0
    if (code === 'aborted') return
    haptic.error()
    error.value = code
    if (PAGE_CODES.has(code)) emit('rejected', code)
  } finally {
    uploadAbort = null
  }
}

function cancelUpload() {
  uploadAbort?.abort()
}

// The page sends the frame in review again once a refusal it handles
// is resolved (consent given over the camera).
defineExpose({ send })

onBeforeUnmount(() => {
  disposed = true
  uploadAbort?.abort()
  if (timer) clearInterval(timer)
  if (timeoutId) clearTimeout(timeoutId)
  if (recorder.value && recorder.value.state !== 'inactive') recorder.value.stop()
  stopStream()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  emit('busy', false)
})

const recordProgress = computed(() => Math.min(100, (elapsedMs.value / MAX_MS) * 100))
const seconds = computed(() => (elapsedMs.value / 1000).toFixed(1))

const errorMessage = computed(() => messageFor(error.value, { sec: MIN_MS / 1000 }))
const cameraIssueMessage = computed(() => messageFor(cameraIssue.value))
const canRetryCamera = computed(() => !['insecure_context', 'camera_unsupported', 'recorder_unsupported'].includes(cameraIssue.value ?? ''))
</script>

<template>
  <div class="relative flex h-full flex-1 flex-col">
    <!-- IDLE — illustration above, full-width CTA at the bottom -->
    <div v-if="state === 'idle'" class="flex flex-1 flex-col">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-amber-50 to-amber-100 shadow-[0_8px_24px_rgb(180_130_60_/_0.12)]">
          <Video class="h-10 w-10 text-amber-700" :stroke-width="1.4" />
        </div>
        <h3 class="mt-5 font-display text-2xl italic text-(--color-foreground)">
          {{ t('guest.camera.videoModeTitle') }}
        </h3>
        <p class="mt-2 max-w-[16rem] text-sm leading-relaxed text-(--color-muted-foreground)">
          {{ t('guest.camera.videoHint') }}
        </p>
      </div>

      <button
        type="button"
        class="mb-2 inline-flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-(--color-primary) text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform duration-100 active:scale-[0.98]"
        @click="startCamera"
      >
        <Video class="h-5 w-5" :stroke-width="1.8" />
        {{ t('guest.camera.recordVideo') }}
      </button>
    </div>

    <!-- Error: the camera / recorder can't run here -->
    <div v-else-if="state === 'error'" class="flex flex-1 flex-col justify-center">
      <div class="surface-card rounded-(--radius-xl) p-6 text-center">
        <p class="font-medium text-red-700">{{ cameraIssueMessage }}</p>
        <p v-if="inApp" class="mt-2 text-sm text-(--color-muted-foreground)">{{ t('guest.errors.in_app_hint') }}</p>
        <button
          v-if="canRetryCamera"
          type="button"
          class="mt-4 inline-flex h-11 touch-manipulation items-center rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 active:scale-[0.98]"
          @click="startCamera"
        >{{ t('guest.camera.tryAgain') }}</button>
      </div>
    </div>

    <!-- Live / recording / review viewport. Same shrinking flex
         trick as GuestCamera so the dock never gets pushed off
         the bottom on shorter phones; same fullscreen toggle for
         the rare moment a guest wants to compose a wider shot. -->
    <div
      v-else
      ref="viewportEl"
      :class="[
        'relative overflow-hidden bg-black transition-[border-radius] duration-200',
        isFull
          ? 'fixed inset-0 z-50 rounded-none border-0'
          : 'flex-1 min-h-0 rounded-(--radius-xl) border border-(--color-border)/60',
      ]"
    >
      <!-- Fullscreen toggle: hide while uploading so the user doesn't
           tap it mid-progress. -->
      <button
        v-if="state === 'live' || state === 'review'"
        type="button"
        :aria-label="isFull ? t('guest.aria.exitFullscreen') : t('guest.aria.fullscreen')"
        class="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
        @click="tapFullscreen"
      >
        <Minimize2 v-if="isFull" class="h-4 w-4" :stroke-width="1.8" />
        <Maximize2 v-else class="h-4 w-4" :stroke-width="1.8" />
      </button>
      <video
        v-show="state === 'starting' || state === 'live' || state === 'recording'"
        ref="videoEl"
        playsinline
        muted
        autoplay
        class="absolute inset-0 block h-full w-full object-cover"
      />
      <div v-if="state === 'starting'" class="absolute inset-0 grid place-items-center text-white/80">
        <div class="flex flex-col items-center gap-3">
          <Loader2 class="h-8 w-8 animate-spin" :stroke-width="1.6" />
          <p class="text-sm">{{ t('guest.camera.starting') }}</p>
        </div>
      </div>
      <!-- Review: the clip fills the viewport like the live feed and
           plays on tap. Native controls sat under our retake/send bar,
           so tapping ▶ hit "retake" and deleted the clip. -->
      <video
        v-if="state === 'review' || state === 'uploading'"
        ref="previewEl"
        :src="previewUrl ?? ''"
        playsinline
        loop
        class="absolute inset-0 block h-full w-full bg-black object-contain"
        @click="togglePreview"
        @play="previewPlaying = true"
        @pause="previewPlaying = false"
      />
      <button
        v-if="state === 'review' && !previewPlaying"
        type="button"
        :aria-label="t('guest.aria.play')"
        class="absolute left-1/2 top-1/2 z-10 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 touch-manipulation place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm"
        @click="togglePreview"
      >
        <Play class="ml-1 h-7 w-7" fill="currentColor" />
      </button>

      <!-- Non-fatal error over the viewport (visible in fullscreen) -->
      <p
        v-if="errorMessage && state !== 'uploading' && state !== 'recording'"
        role="alert"
        class="absolute inset-x-3 top-3 z-10 mr-12 rounded-xl bg-white/95 px-3 py-2 text-sm leading-snug text-red-700 shadow-lg"
      >{{ errorMessage }}</p>

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
          <div class="h-full origin-left bg-red-500 transition-transform duration-100 ease-linear" :style="{ transform: `scaleX(${recordProgress / 100})` }" />
        </div>
      </div>

      <!-- Uploading: real progress now that video goes through XHR -->
      <div v-if="state === 'uploading'" class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white">
        <div class="relative h-20 w-20">
          <svg viewBox="0 0 100 100" class="h-full w-full -rotate-90">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="6" />
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke="white" stroke-width="6" stroke-linecap="round"
              :stroke-dasharray="289.027"
              :stroke-dashoffset="289.027 - (289.027 * uploadPercent) / 100"
              style="transition: stroke-dashoffset 200ms"
            />
          </svg>
          <span class="absolute inset-0 grid place-items-center font-mono text-base">{{ uploadPercent }}%</span>
        </div>
        <p class="mt-3 text-sm">
          {{ retryAttempt > 1 ? t('guest.camera.retrying', { n: retryAttempt }) : t('guest.camera.uploadingShort') }}
        </p>
      </div>

      <!-- Controls -->
      <div class="absolute inset-x-0 bottom-0 z-10 grid grid-cols-3 items-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-4">
        <button
          v-if="state === 'live'"
          type="button"
          :aria-label="t('guest.aria.switchCamera')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          @click="flip"
        >
          <RefreshCw class="h-5 w-5" />
        </button>
        <button
          v-else-if="state === 'review'"
          type="button"
          :aria-label="t('guest.aria.retake')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          @click="retake"
        >
          <X class="h-5 w-5" />
        </button>
        <button
          v-else-if="state === 'uploading'"
          type="button"
          :aria-label="t('guest.aria.cancelUpload')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur"
          @click="cancelUpload"
        >
          <X class="h-5 w-5" />
        </button>
        <div v-else />

        <div class="grid place-items-center">
          <motion.button
            v-if="state === 'live' || state === 'starting'"
            key="rec"
            type="button"
            :aria-label="t('guest.aria.startRecording')"
            :disabled="state !== 'live'"
            class="grid h-16 w-16 touch-manipulation place-items-center rounded-full border-4 border-white/80 bg-red-500 shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] disabled:opacity-40"
            :while-press="reduceMotion ? undefined : { scale: 0.9 }"
            :transition="spring"
            @click="startRecording"
          >
            <Circle class="h-6 w-6 text-white" fill="currentColor" />
          </motion.button>
          <motion.button
            v-else-if="state === 'recording'"
            key="stop"
            type="button"
            :aria-label="t('guest.aria.stopRecording')"
            class="grid h-16 w-16 touch-manipulation place-items-center rounded-full border-4 border-white/80 bg-red-500 shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)]"
            :while-press="reduceMotion ? undefined : { scale: 0.9 }"
            :transition="spring"
            @click="stopRecording"
          >
            <Square class="h-6 w-6 text-white" fill="currentColor" />
          </motion.button>
          <motion.button
            v-else-if="state === 'review'"
            key="send"
            type="button"
            :aria-label="t('guest.aria.send')"
            class="grid h-16 w-16 touch-manipulation place-items-center rounded-full bg-(--color-primary) text-white shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)]"
            :initial="reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }"
            :animate="{ opacity: 1, scale: 1 }"
            :while-press="reduceMotion ? undefined : { scale: 0.9 }"
            :transition="spring"
            @click="send"
          >
            <Check class="h-7 w-7" :stroke-width="2" />
          </motion.button>
          <div v-else class="h-16 w-16" />
        </div>

        <div />
      </div>
    </div>
  </div>
</template>
