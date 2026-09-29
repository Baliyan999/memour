<script setup lang="ts">
import { ref, computed, onBeforeUnmount, watch } from 'vue'
import { Mic, Square, Check, X, Play, Pause, Loader2 } from '@lucide/vue'
import { useI18n } from '#imports'

const { t } = useI18n()
const haptic = useHaptic()

/**
 * GuestVoice — record a voice message (3-60 sec) and upload as
 * media_type=voice. No video preview needed — we show a waveform-ish
 * animated visualization driven by AnalyserNode RMS.
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
const MAX_MS = 60000

type State = 'idle' | 'ready' | 'recording' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
// Why the mic can't run (error card) vs. why the last send failed.
const micIssue = ref<string | null>(null)
const error = ref<string | null>(null)
const uploadPercent = ref(0)
const retryAttempt = ref(0)
let uploadId = ''
let uploadAbort: AbortController | null = null
let disposed = false

const stream = ref<MediaStream | null>(null)
const recorder = ref<MediaRecorder | null>(null)
const chunks = ref<Blob[]>([])
const lastBlob = ref<Blob | null>(null)
const lastMime = ref<string>('audio/webm')
const previewUrl = ref<string | null>(null)
const elapsedMs = ref(0)
const playing = ref(false)
const audioEl = ref<HTMLAudioElement | null>(null)

// Visualization
const audioCtx = ref<AudioContext | null>(null)
const analyser = ref<AnalyserNode | null>(null)
const level = ref(0) // 0..1 — RMS
let rafId: number | undefined

let timer: number | undefined
let timeoutId: number | undefined

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg']

const location = useGuestLocation(() => props.geofenceEnabled)
const messageFor = useGuestErrorMessage('voice')
const inApp = isInAppBrowser()

watch(state, (s) => emit('busy', s === 'recording' || s === 'review' || s === 'uploading'))

async function requestMic() {
  error.value = null
  micIssue.value = captureSupportIssue()
    ?? (typeof MediaRecorder === 'undefined' ? 'recorder_unsupported' : null)
  if (micIssue.value) {
    state.value = 'error'
    return
  }
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    if (disposed) {
      s.getTracks().forEach((t) => t.stop())
      return
    }
    stream.value = s

    // Set up live analysis for the waveform animation. Purely
    // decorative — a browser without Web Audio still records.
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext
      audioCtx.value = new Ctx()
      const src = audioCtx.value!.createMediaStreamSource(s)
      const a = audioCtx.value!.createAnalyser()
      a.fftSize = 256
      src.connect(a)
      analyser.value = a
    } catch { /* no level meter */ }

    state.value = 'ready'
    runLevelLoop()
  } catch (e) {
    state.value = 'error'
    micIssue.value = mediaErrorCode(e, 'mic')
  }
}

function runLevelLoop() {
  const a = analyser.value
  if (!a) return
  const data = new Uint8Array(a.frequencyBinCount)
  const loop = () => {
    a.getByteTimeDomainData(data)
    // RMS calc
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128
      sum += v * v
    }
    level.value = Math.min(1, Math.sqrt(sum / data.length) * 2.5)
    rafId = requestAnimationFrame(loop)
  }
  rafId = requestAnimationFrame(loop)
}

function startRecording() {
  if (!stream.value || state.value !== 'ready') return
  const rec = createRecorder(stream.value, MIME_CANDIDATES, { audioBitsPerSecond: 96_000 })
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
    lastMime.value = rec.mimeType || chunks.value[0]?.type || 'audio/webm'
    const blob = new Blob(chunks.value, { type: lastMime.value })
    lastBlob.value = blob
    uploadId = randomUuid()
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = URL.createObjectURL(blob)
    reviewSince = performance.now()
    state.value = 'review'
  }
  try {
    rec.start(100)
  } catch {
    error.value = 'recorder_unsupported'
    haptic.error()
    return
  }
  recorder.value = rec
  state.value = 'recording'
  elapsedMs.value = 0
  const startedAt = Date.now()
  timer = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt
  }, 80) as unknown as number
  timeoutId = window.setTimeout(() => stopRecording(), MAX_MS) as unknown as number
}

function stopRecording() {
  haptic.tap()
  if (timer) clearInterval(timer)
  if (timeoutId) clearTimeout(timeoutId)
  if (recorder.value && recorder.value.state !== 'inactive') recorder.value.stop()
}

function retake() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  lastBlob.value = null
  elapsedMs.value = 0
  playing.value = false
  error.value = null
  state.value = stream.value ? 'ready' : 'idle'
}

function togglePlay() {
  if (!audioEl.value) return
  if (playing.value) {
    audioEl.value.pause()
    playing.value = false
  } else {
    audioEl.value.play().catch(() => {})
    playing.value = true
  }
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
  if (playing.value) togglePlay()
  state.value = 'uploading'
  uploadPercent.value = 0
  retryAttempt.value = 0
  error.value = null
  uploadAbort = new AbortController()
  try {
    const blob = lastBlob.value
    const ext = lastMime.value.includes('mp4') ? 'm4a'
      : lastMime.value.includes('mpeg') ? 'mp3'
      : lastMime.value.includes('ogg') ? 'ogg'
      : 'webm'
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
        fd.append('media_type', 'voice')
        fd.append('duration_ms', String(Math.min(elapsedMs.value, MAX_MS)))
        fd.append('file', new File([blob], `voice.${ext}`, { type: lastMime.value }))
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

// "Stop" sits where "re-record" appears, so the same quick-double-tap
// guard applies — otherwise one fumble throws the recording away.
function discardTap() {
  if (performance.now() - reviewSince < REVIEW_ARM_MS) return
  retake()
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
  if (rafId) cancelAnimationFrame(rafId)
  if (recorder.value && recorder.value.state !== 'inactive') recorder.value.stop()
  if (audioCtx.value) audioCtx.value.close().catch(() => {})
  if (stream.value) stream.value.getTracks().forEach((t) => t.stop())
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  emit('busy', false)
})

const seconds = computed(() => (elapsedMs.value / 1000).toFixed(1))
const progress = computed(() => Math.min(100, (elapsedMs.value / MAX_MS) * 100))

const errorMessage = computed(() => messageFor(error.value, { sec: MIN_MS / 1000 }))
const micIssueMessage = computed(() => messageFor(micIssue.value))
const canRetryMic = computed(() => !['insecure_context', 'camera_unsupported', 'recorder_unsupported'].includes(micIssue.value ?? ''))
</script>

<template>
  <div class="relative flex h-full flex-1 flex-col">
    <!-- IDLE — illustration above, full-width CTA at the bottom -->
    <div v-if="state === 'idle'" class="flex flex-1 flex-col">
      <div class="flex flex-1 flex-col items-center justify-center text-center">
        <div class="grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-amber-50 to-amber-100 shadow-[0_8px_24px_rgb(180_130_60_/_0.12)]">
          <Mic class="h-10 w-10 text-amber-700" :stroke-width="1.4" />
        </div>
        <h3 class="mt-5 font-display text-2xl italic text-(--color-foreground)">
          {{ t('guest.camera.voiceModeTitle') }}
        </h3>
        <p class="mt-2 max-w-[16rem] text-sm leading-relaxed text-(--color-muted-foreground)">
          {{ t('guest.camera.voiceHint') }}
        </p>
      </div>

      <button
        type="button"
        class="mb-2 inline-flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-full bg-(--color-primary) text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform duration-100 active:scale-[0.98]"
        @click="requestMic"
      >
        <Mic class="h-5 w-5" :stroke-width="1.8" />
        {{ t('guest.camera.recordVoice') }}
      </button>
    </div>

    <!-- Recording stage -->
    <div
      v-else-if="state !== 'error'"
      class="rounded-(--radius-xl) border border-(--color-border)/60 bg-white p-8 text-center"
    >
      <!-- Animated mic + level -->
      <div class="relative mx-auto h-32 w-32">
        <div
          class="absolute inset-0 rounded-full bg-(--color-primary)/15 transition-transform duration-100"
          :style="{ transform: `scale(${state === 'recording' ? 1 + level * 0.5 : 1})` }"
        />
        <div
          class="absolute inset-4 rounded-full bg-(--color-primary)/25 transition-transform duration-100"
          :style="{ transform: `scale(${state === 'recording' ? 1 + level * 0.3 : 1})` }"
        />
        <div class="absolute inset-9 grid place-items-center rounded-full bg-(--color-primary) text-white">
          <Mic class="h-9 w-9" :stroke-width="1.6" />
        </div>
      </div>

      <p class="mt-6 font-mono text-2xl">{{ seconds }}<span class="text-(--color-muted-foreground) text-base"> / {{ MAX_MS / 1000 }} s</span></p>

      <div v-if="state === 'recording'" class="mt-3 h-1.5 overflow-hidden rounded-full bg-(--color-muted)">
        <div class="h-full origin-left bg-red-500 transition-transform duration-100 ease-linear" :style="{ transform: `scaleX(${progress / 100})` }" />
      </div>

      <!-- Hidden audio for review playback -->
      <audio
        v-if="previewUrl"
        ref="audioEl"
        :src="previewUrl"
        class="hidden"
        @ended="playing = false"
      />

      <!-- Controls -->
      <div class="mt-7 flex items-center justify-center gap-4">
        <!-- Ready state -->
        <button
          v-if="state === 'ready'"
          type="button"
          class="inline-flex h-12 touch-manipulation items-center gap-2 rounded-full bg-red-500 px-6 text-sm font-medium text-white transition-transform duration-100 hover:opacity-90 active:scale-[0.97]"
          @click="startRecording"
        >
          <span class="h-3 w-3 rounded-full bg-white" />
          {{ t('guest.camera.startRecording') }}
        </button>

        <!-- Recording state -->
        <button
          v-else-if="state === 'recording'"
          type="button"
          class="inline-flex h-12 touch-manipulation items-center gap-2 rounded-full bg-(--color-foreground) px-6 text-sm font-medium text-white transition-transform duration-100 hover:opacity-90 active:scale-[0.97]"
          @click="stopRecording"
        >
          <Square class="h-4 w-4" fill="currentColor" />
          {{ t('guest.camera.stopRecording') }}
        </button>

        <!-- Review state -->
        <template v-else-if="state === 'review'">
          <button
            type="button"
            class="grid h-12 w-12 touch-manipulation place-items-center rounded-full border border-(--color-border) bg-white text-(--color-foreground) transition-transform duration-100 hover:bg-(--color-muted) active:scale-[0.95]"
            @click="togglePlay"
            :aria-label="playing ? t('guest.aria.pause') : t('guest.aria.play')"
          >
            <Pause v-if="playing" class="h-5 w-5" />
            <Play v-else class="h-5 w-5" />
          </button>
          <button
            type="button"
            :aria-label="t('guest.aria.rerecord')"
            class="grid h-12 w-12 touch-manipulation place-items-center rounded-full border border-(--color-border) bg-white text-(--color-foreground) transition-transform duration-100 hover:bg-(--color-muted) active:scale-[0.95]"
            @click="discardTap"
          >
            <X class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="inline-flex h-12 touch-manipulation items-center gap-2 rounded-full bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 hover:opacity-90 active:scale-[0.97]"
            @click="send"
          >
            <Check class="h-5 w-5" />
            {{ t('guest.camera.send') }}
          </button>
        </template>

        <!-- Uploading: progress + cancel (the recording is kept) -->
        <template v-else-if="state === 'uploading'">
          <button
            type="button"
            :aria-label="t('guest.aria.cancelUpload')"
            class="grid h-12 w-12 touch-manipulation place-items-center rounded-full border border-(--color-border) bg-white text-(--color-foreground) hover:bg-(--color-muted)"
            @click="cancelUpload"
          >
            <X class="h-5 w-5" />
          </button>
          <div class="inline-flex h-12 items-center gap-2 rounded-full bg-(--color-muted) px-5 text-sm text-(--color-foreground)">
            <Loader2 class="h-4 w-4 animate-spin" :stroke-width="1.8" />
            <span>{{ retryAttempt > 1 ? t('guest.camera.retrying', { n: retryAttempt }) : t('guest.camera.uploadingShort') }}</span>
            <span class="font-mono tabular-nums">{{ uploadPercent }}%</span>
          </div>
        </template>
      </div>

      <p
        v-if="errorMessage && state !== 'uploading'"
        role="alert"
        class="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
      >{{ errorMessage }}</p>
    </div>

    <!-- Error: the mic / recorder can't run here -->
    <div v-else class="surface-card rounded-(--radius-xl) p-6 text-center">
      <p class="font-medium text-red-700">{{ micIssueMessage }}</p>
      <p v-if="inApp" class="mt-2 text-sm text-(--color-muted-foreground)">{{ t('guest.errors.in_app_hint') }}</p>
      <button
        v-if="canRetryMic"
        type="button"
        class="mt-4 inline-flex h-11 touch-manipulation items-center rounded-full bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) transition-transform duration-100 active:scale-[0.98]"
        @click="requestMic"
      >{{ t('guest.camera.tryAgain') }}</button>
    </div>
  </div>
</template>
