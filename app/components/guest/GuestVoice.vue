<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { Mic, Square, Check, X, Play, Pause, Loader2 } from '@lucide/vue'
import { useI18n } from '#imports'

const { t, te } = useI18n()

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
  (e: 'quota_exceeded'): void
  (e: 'wrong_table'): void
}>()

const MIN_MS = 3000
const MAX_MS = 60000

type State = 'idle' | 'ready' | 'recording' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
const error = ref<string | null>(null)

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

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg']
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m
  }
  return 'audio/webm'
}

async function requestMic() {
  error.value = null
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    stream.value = s

    // Set up live analysis for the waveform animation
    audioCtx.value = new AudioContext()
    const src = audioCtx.value.createMediaStreamSource(s)
    const a = audioCtx.value.createAnalyser()
    a.fftSize = 256
    src.connect(a)
    analyser.value = a

    state.value = 'ready'
    runLevelLoop()
  } catch (e: any) {
    state.value = 'error'
    error.value = e?.name === 'NotAllowedError' ? 'permission_denied' : 'mic_unavailable'
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
  rec.start(100)
  state.value = 'recording'
  const startedAt = Date.now()
  timer = window.setInterval(() => {
    elapsedMs.value = Date.now() - startedAt
  }, 80) as unknown as number
  timeoutId = window.setTimeout(() => stopRecording(), MAX_MS) as unknown as number
}

function stopRecording() {
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
  state.value = 'ready'
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
    const ext = lastMime.value.includes('mp4') ? 'm4a'
      : lastMime.value.includes('mpeg') ? 'mp3'
      : 'webm'
    const coords = await getLocation()
    const fd = new FormData()
    fd.append('event_id', props.eventId)
    fd.append('device_id', props.deviceId)
    fd.append('guest_table', String(props.guestTable))
    fd.append('media_type', 'voice')
    fd.append('duration_ms', String(elapsedMs.value))
    fd.append('file', new File([lastBlob.value], `voice.${ext}`, { type: lastMime.value }))
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
  if (rafId) cancelAnimationFrame(rafId)
  if (recorder.value && recorder.value.state !== 'inactive') recorder.value.stop()
  if (audioCtx.value) audioCtx.value.close().catch(() => {})
  if (stream.value) stream.value.getTracks().forEach((t) => t.stop())
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

const seconds = computed(() => (elapsedMs.value / 1000).toFixed(1))
const progress = computed(() => Math.min(100, (elapsedMs.value / MAX_MS) * 100))

const errorMessage = computed(() => {
  if (!error.value) return null
  const code = error.value
  if (code === 'too_short') {
    return t('guest.errors.too_short', { sec: MIN_MS / 1000 })
  }
  if (code === 'permission_denied') {
    return t('guest.errors.permission_denied_mic_only')
  }
  const kindKey = `guest.errors.${code}_voice`
  if (te(kindKey)) return t(kindKey)
  const baseKey = `guest.errors.${code}`
  if (te(baseKey)) return t(baseKey)
  return t('guest.camera.genericError')
})
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
        class="mb-2 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-(--color-primary) text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform active:scale-[0.98]"
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
        <div class="h-full bg-red-500 transition-all duration-100" :style="{ width: `${progress}%` }" />
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
          class="inline-flex h-12 items-center gap-2 rounded-full bg-red-500 px-6 text-sm font-medium text-white hover:opacity-90"
          @click="startRecording"
        >
          <span class="h-3 w-3 rounded-full bg-white" />
          {{ t('guest.camera.startRecording') }}
        </button>

        <!-- Recording state -->
        <button
          v-else-if="state === 'recording'"
          type="button"
          class="inline-flex h-12 items-center gap-2 rounded-full bg-(--color-foreground) px-6 text-sm font-medium text-white hover:opacity-90"
          @click="stopRecording"
        >
          <Square class="h-4 w-4" fill="currentColor" />
          {{ t('guest.camera.stopRecording') }}
        </button>

        <!-- Review state -->
        <template v-else-if="state === 'review'">
          <button
            type="button"
            class="grid h-12 w-12 place-items-center rounded-full border border-(--color-border) bg-white text-(--color-foreground) hover:bg-(--color-muted)"
            @click="togglePlay"
            :aria-label="playing ? t('guest.aria.pause') : t('guest.aria.play')"
          >
            <Pause v-if="playing" class="h-5 w-5" />
            <Play v-else class="h-5 w-5" />
          </button>
          <button
            type="button"
            :aria-label="t('guest.aria.rerecord')"
            class="grid h-12 w-12 place-items-center rounded-full border border-(--color-border) bg-white text-(--color-foreground) hover:bg-(--color-muted)"
            @click="retake"
          >
            <X class="h-5 w-5" />
          </button>
          <button
            type="button"
            class="inline-flex h-12 items-center gap-2 rounded-full bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
            @click="send"
          >
            <Check class="h-5 w-5" />
            {{ t('guest.camera.send') }}
          </button>
        </template>

        <Loader2 v-else-if="state === 'uploading'" class="h-10 w-10 animate-spin text-(--color-primary)" :stroke-width="1.6" />
      </div>
    </div>

    <!-- Error -->
    <div v-else class="surface-card rounded-(--radius-xl) p-6 text-center">
      <p class="font-medium text-red-700">{{ errorMessage }}</p>
      <button
        type="button"
        class="mt-4 inline-flex h-11 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-white hover:opacity-90"
        @click="requestMic"
      >{{ t('guest.camera.tryAgain') }}</button>
    </div>

    <p
      v-if="errorMessage && state !== 'error'"
      class="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >{{ errorMessage }}</p>
  </div>
</template>
