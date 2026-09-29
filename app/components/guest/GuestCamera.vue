<script setup lang="ts">
import { ref, onBeforeUnmount, watch, computed, nextTick } from 'vue'
import imageCompression from 'browser-image-compression'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { Camera, RefreshCw, Check, X, Maximize2, Minimize2, Loader2, ImagePlus } from '@lucide/vue'
import { useI18n } from '#imports'

const haptic = useHaptic()
const { isFull, toggle: toggleFullscreen, exit: exitFullscreen } = useFullscreen()
const viewportEl = ref<HTMLElement | null>(null)
function tapFullscreen() {
  if (viewportEl.value) toggleFullscreen(viewportEl.value)
}

/**
 * GuestCamera — captures photos with the device camera and uploads
 * them to /api/guest/upload one by one. Two states cycle: live (video
 * preview) and review (last shot preview, choose to retake or send).
 *
 * Why <video> + <canvas> instead of <input type="file"
 * capture="environment"> — the dedicated capture input opens the
 * native camera app which kicks the user out of the browser tab and
 * loses the session/UI continuity. Manual MediaStream gives us a
 * persistent in-browser flow. The file input is only the fallback
 * when the in-page camera can't start (denied, in-app browser, http).
 *
 * The captured blob is kept until the server confirms it; a failed or
 * cancelled send drops back to review with the same frame and the
 * same upload_id, so a retry can never create a second copy.
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
    photo: {
      id: string
      uploaded_at: string
      counts?: { photo_count: number; video_count: number; voice_count: number }
    },
  ): void
  /** Server refused for a reason the page handles (quota, table, window…). */
  (e: 'rejected', code: string): void
  /** True while a frame is in review / on its way — the page locks the mode switch. */
  (e: 'busy', busy: boolean): void
}>()

type State = 'idle' | 'starting' | 'live' | 'capturing' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
// Why the camera can't run (fatal, shown on the error card).
const cameraIssue = ref<string | null>(null)
// Why the last capture / send failed (shown over the viewport).
const error = ref<string | null>(null)
const uploadPercent = ref(0)
const retryAttempt = ref(0)

const videoEl = ref<HTMLVideoElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const stream = ref<MediaStream | null>(null)
const previewUrl = ref<string | null>(null)
const lastBlob = ref<Blob | null>(null)
// Compressed once per frame; retries resend the same bytes.
let compressed: File | null = null
let uploadId = ''
let uploadAbort: AbortController | null = null
let disposed = false
// Bumped per startCamera(): a double tap on "flip" starts two requests,
// and only the newest may keep its stream (the other would stay lit).
let cameraRequest = 0
const facing = ref<'environment' | 'user'>('environment')

const location = useGuestLocation(() => props.geofenceEnabled)
const messageFor = useGuestErrorMessage('photo')
const inApp = isInAppBrowser()

const reduceMotion = useReducedMotion()
// Critically damped by default; reduced motion gets a short fade.
const spring = computed(() => (reduceMotion.value
  ? { duration: 0.15 }
  : { type: 'spring' as const, bounce: 0, duration: 0.35 }))

watch(state, (s) => {
  emit('busy', s === 'capturing' || s === 'review' || s === 'uploading')
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
  if (cameraIssue.value) {
    state.value = 'error'
    return
  }
  // The viewport shows immediately (black + spinner); the shutter
  // appears only once frames flow. Pressing it before the first frame
  // used to capture a 0×0 canvas and hang in 'capturing' forever.
  state.value = 'starting'
  const request = ++cameraRequest
  try {
    stopStream()
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing.value }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
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

function flipCamera() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment'
  startCamera()
}

// How the review frame leaves: shrinking toward the shutter when it
// was sent, a plain fade when the guest discards it.
const sentExit = ref(false)

function setReview(blob: Blob) {
  sentExit.value = false
  lastBlob.value = blob
  compressed = null
  uploadId = randomUuid()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
  reviewSince = performance.now()
  state.value = 'review'
}

async function capture() {
  const video = videoEl.value
  const canvas = canvasEl.value
  if (state.value !== 'live' || !video || !canvas || !stream.value) return
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return // no frame yet — ignore the tap
  haptic.tap()
  location.prime()
  state.value = 'capturing'
  error.value = null
  try {
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
    })
    setReview(blob)
  } catch {
    state.value = 'live'
    error.value = 'capture_failed'
    haptic.error()
  }
}

// System camera / gallery fallback when the in-page camera can't run.
function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  input.value = ''
  if (!f) return
  if (!/^image\//.test(f.type)) {
    error.value = 'unsupported_mime'
    return
  }
  error.value = null
  setReview(f)
}

// Blob URLs of sent frames that are still flying out: the exit
// animation keeps drawing the image (and the browser may load it
// again), so they're revoked once AnimatePresence says it's gone.
let leaving: string[] = []
function releaseLeaving() {
  for (const url of leaving) URL.revokeObjectURL(url)
  leaving = []
}

function discardFrame({ animatingOut = false } = {}) {
  if (previewUrl.value) {
    if (animatingOut) leaving.push(previewUrl.value)
    else URL.revokeObjectURL(previewUrl.value)
  }
  previewUrl.value = null
  lastBlob.value = null
  compressed = null
}

function retake() {
  discardFrame()
  error.value = null
  // A frame from the file fallback has no live stream to go back to.
  state.value = stream.value ? 'live' : cameraIssue.value ? 'error' : 'idle'
}

// The send button appears exactly where the shutter was. A quick
// double-tap on the shutter used to land its second tap on "send"
// and upload a frame the guest never saw. Taps within this window
// after review opens are ignored.
const REVIEW_ARM_MS = 450
let reviewSince = 0

// Codes the page reacts to (switching screens); everything else is
// shown here and the frame stays in review for another try.
const PAGE_CODES = new Set(['quota_exceeded', 'wrong_table', 'window_not_open', 'window_closed', 'event_not_active', 'not_in_plan', 'invalid_table', 'consent_required'])

async function send() {
  if (!lastBlob.value || state.value !== 'review') return
  if (performance.now() - reviewSince < REVIEW_ARM_MS) return
  haptic.tap()
  state.value = 'uploading'
  uploadPercent.value = 0
  retryAttempt.value = 0
  error.value = null
  uploadAbort = new AbortController()
  try {
    // Client-side compression so the user's slow uplink doesn't choke
    // on a 4 MB phone JPEG; we get ~500 KB at decent quality. Done
    // once per frame — retries reuse the result.
    if (!compressed) {
      compressed = await imageCompression(
        new File([lastBlob.value], 'photo.jpg', { type: lastBlob.value.type || 'image/jpeg' }),
        { maxSizeMB: 0.7, maxWidthOrHeight: 2200, useWebWorker: true, initialQuality: 0.85 },
      )
    }
    const file = compressed
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
        fd.append('file', file, 'photo.jpg')
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
    sentExit.value = true
    await nextTick() // let the frame pick up its "sent" exit first
    discardFrame({ animatingOut: true })
    state.value = stream.value ? 'live' : cameraIssue.value ? 'error' : 'idle'
  } catch (e: any) {
    const code: string = e?.code ?? 'upload_failed'
    state.value = 'review'
    reviewSince = 0 // already armed — the guest may resend at once
    if (code === 'aborted') return // guest pressed cancel; keep the frame quietly
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
  stopStream()
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  releaseLeaving()
  emit('busy', false)
})

const errorMessage = computed(() => messageFor(error.value))
const cameraIssueMessage = computed(() => messageFor(cameraIssue.value))
// Worth offering "try again" only for problems a retry can fix.
const canRetryCamera = computed(() => cameraIssue.value !== 'insecure_context' && cameraIssue.value !== 'camera_unsupported')

const { t } = useI18n()
</script>

<template>
  <div class="relative flex h-full flex-1 flex-col">
    <!-- Hidden canvas — used only to convert video frame to blob -->
    <canvas ref="canvasEl" class="hidden" />

    <!-- IDLE: pre-permission entry. Illustration centered in the
         available vertical space, CTA pinned to the bottom of the
         column so the thumb falls on it without stretching. -->
    <div v-if="state === 'idle'" class="flex flex-1 flex-col">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-amber-50 to-amber-100 shadow-[0_8px_24px_rgb(180_130_60_/_0.12)]">
          <Camera class="h-10 w-10 text-amber-700" :stroke-width="1.4" />
        </div>
        <h3 class="mt-5 font-display text-2xl italic text-(--color-foreground)">
          {{ t('guest.camera.photoModeTitle') }}
        </h3>
        <p class="mt-2 max-w-[14rem] text-sm leading-relaxed text-(--color-muted-foreground)">
          {{ t('guest.camera.cameraHint') }}
        </p>
      </div>

      <button
        type="button"
        class="mb-2 inline-flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-(--color-primary) text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform duration-100 active:scale-[0.98]"
        @click="startCamera"
      >
        <Camera class="h-5 w-5" :stroke-width="1.8" />
        <span>{{ t('guest.camera.openCamera') }}</span>
      </button>
    </div>

    <!-- ERROR: the camera can't run here. Explain why in the guest's
         language and always leave a way forward — the system camera
         (or gallery) through a plain file input. -->
    <div v-else-if="state === 'error'" class="flex flex-1 flex-col justify-center">
      <div class="surface-card rounded-(--radius-xl) p-6 text-center">
        <p class="font-medium text-red-700">{{ cameraIssueMessage }}</p>
        <p v-if="inApp" class="mt-2 text-sm text-(--color-muted-foreground)">{{ t('guest.errors.in_app_hint') }}</p>
        <label
          class="mt-5 inline-flex h-12 w-full cursor-pointer touch-manipulation items-center justify-center gap-2 rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 active:scale-[0.98]"
        >
          <ImagePlus class="h-5 w-5" :stroke-width="1.8" />
          {{ t('guest.camera.useSystemCamera') }}
          <input type="file" accept="image/*" capture="environment" class="sr-only" @change="onPickFile">
        </label>
        <button
          v-if="canRetryCamera"
          type="button"
          class="mt-3 inline-flex h-11 items-center rounded-full px-5 text-sm font-medium text-(--color-foreground) underline-offset-4 hover:underline"
          @click="startCamera"
        >{{ t('guest.camera.tryAgain') }}</button>
        <p v-if="errorMessage" class="mt-3 text-sm text-red-700" role="alert">{{ errorMessage }}</p>
      </div>
    </div>

    <!-- STARTING / LIVE / REVIEW / UPLOADING viewport.
         `flex-1 min-h-0` lets the box shrink to fit short phones
         instead of forcing aspect-ratio 3/4. When the user taps the
         expand button the same element gets pinned `fixed inset-0
         z-50` — covers header + dock + the browser URL bar without
         needing the (flaky on iOS) native Fullscreen API. -->
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
      <!-- Top-right: expand / minimize toggle. Hidden while starting
           and uploading — nothing to frame then. -->
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

      <!-- Live video.
           iOS Safari historically renders `<video srcObject>` letter-
           boxed (effective object-contain) even when CSS says
           `object-fit: cover`. Forcing `position: absolute; inset: 0`
           plus `display: block` + the `autoplay` attribute is the
           known-good combo that gets the stream to actually fill
           the box on every browser we care about. Without it the
           viewport painted a black band at the bottom on iPhone. -->
      <video
        v-show="state === 'starting' || state === 'live' || state === 'capturing'"
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

      <!-- Review preview — same absolute-fill trick as the live
           video. On a successful send it shrinks away toward the
           shutter and the live feed underneath takes over. -->
      <AnimatePresence :on-exit-complete="releaseLeaving">
        <motion.img
          v-if="(state === 'review' || state === 'uploading') && previewUrl"
          key="review"
          :src="previewUrl"
          alt=""
          class="absolute inset-0 block h-full w-full object-cover"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="reduceMotion || !sentExit ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 40 }"
          :transition="spring"
        />
      </AnimatePresence>

      <!-- Non-fatal error over the viewport, so it stays visible in
           fullscreen too (a sibling below the viewport was hidden
           behind the fullscreen layer). -->
      <AnimatePresence>
        <motion.p
          v-if="errorMessage && state !== 'uploading'"
          key="err"
          role="alert"
          class="absolute inset-x-3 top-3 z-10 mr-12 rounded-xl bg-white/95 px-3 py-2 text-sm leading-snug text-red-700 shadow-lg"
          :initial="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }"
          :transition="spring"
        >{{ errorMessage }}</motion.p>
      </AnimatePresence>

      <!-- Uploading overlay with real progress -->
      <div
        v-if="state === 'uploading'"
        class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white"
      >
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

      <!-- Bottom controls bar -->
      <div class="absolute inset-x-0 bottom-0 z-10 grid grid-cols-3 items-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-4">
        <!-- Live: flip camera -->
        <button
          v-if="state === 'live'"
          type="button"
          :aria-label="t('guest.aria.switchCamera')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          @click="flipCamera"
        >
          <RefreshCw class="h-5 w-5" :stroke-width="1.8" />
        </button>

        <!-- Review: retake -->
        <button
          v-else-if="state === 'review'"
          type="button"
          :aria-label="t('guest.aria.retake')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          @click="retake"
        >
          <X class="h-5 w-5" :stroke-width="1.8" />
        </button>

        <!-- Uploading: cancel (the frame stays for another try) -->
        <button
          v-else-if="state === 'uploading'"
          type="button"
          :aria-label="t('guest.aria.cancelUpload')"
          class="grid h-11 w-11 touch-manipulation place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          @click="cancelUpload"
        >
          <X class="h-5 w-5" :stroke-width="1.8" />
        </button>

        <div v-else />

        <!-- Center button: shutter (live) or send (review). Both give
             feedback on press, not on release. -->
        <div class="grid place-items-center">
          <motion.button
            v-if="state === 'live' || state === 'starting' || state === 'capturing'"
            key="shutter"
            type="button"
            :aria-label="t('guest.aria.snap')"
            :disabled="state !== 'live'"
            class="h-16 w-16 touch-manipulation rounded-full border-4 border-white/80 bg-white shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] disabled:opacity-40"
            :while-press="reduceMotion ? undefined : { scale: 0.9 }"
            :transition="spring"
            @click="capture"
          />
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
