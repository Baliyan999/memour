<script setup lang="ts">
import { ref, onBeforeUnmount, watch, computed } from 'vue'
import imageCompression from 'browser-image-compression'
import { Camera, RefreshCw, Check, X, Upload, Loader2 } from '@lucide/vue'

/**
 * GuestCamera — captures photos with the device camera and uploads
 * them to /api/guest/upload one by one. Two states cycle: live (video
 * preview) and review (last shot preview, choose to retake or send).
 *
 * Why <video> + <canvas> instead of <input type="file"
 * capture="environment"> — the dedicated capture input opens the
 * native camera app which kicks the user out of the browser tab and
 * loses the session/UI continuity. Manual MediaStream gives us a
 * persistent in-browser flow.
 */
const props = defineProps<{
  eventId: string
  guestName?: string | null
  guestTable?: number | null
  geofenceEnabled: boolean
}>()

const emit = defineEmits<{
  (e: 'uploaded', photo: { id: string; uploaded_at: string }): void
}>()

type State = 'idle' | 'live' | 'capturing' | 'review' | 'uploading' | 'error'
const state = ref<State>('idle')
const error = ref<string | null>(null)
const uploadPercent = ref(0)

const videoEl = ref<HTMLVideoElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const stream = ref<MediaStream | null>(null)
const previewUrl = ref<string | null>(null)
const lastBlob = ref<Blob | null>(null)
const facing = ref<'environment' | 'user'>('environment')

async function startCamera() {
  error.value = null
  try {
    if (stream.value) {
      stream.value.getTracks().forEach((t) => t.stop())
      stream.value = null
    }
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing.value }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    stream.value = s
    state.value = 'live'
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = s
      await videoEl.value.play().catch(() => {})
    }
  } catch (e: any) {
    state.value = 'error'
    error.value = e?.message === 'Permission denied' || e?.name === 'NotAllowedError'
      ? 'permission_denied'
      : 'camera_unavailable'
  }
}

function flipCamera() {
  facing.value = facing.value === 'environment' ? 'user' : 'environment'
  startCamera()
}

async function capture() {
  if (!videoEl.value || !canvasEl.value || !stream.value) return
  state.value = 'capturing'
  const video = videoEl.value
  const canvas = canvasEl.value
  const w = video.videoWidth
  const h = video.videoHeight
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, w, h)
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92)
  })
  lastBlob.value = blob
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(blob)
  state.value = 'review'
}

function retake() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
  lastBlob.value = null
  state.value = 'live'
}

async function getLocation(): Promise<GeolocationCoordinates | null> {
  if (!props.geofenceEnabled || typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return null
  }
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
  state.value = 'uploading'
  uploadPercent.value = 0
  error.value = null
  try {
    // Client-side compression so the user's slow uplink doesn't choke
    // on a 4 MB phone JPEG; we get ~500 KB at decent quality.
    const compressed = await imageCompression(
      new File([lastBlob.value], 'photo.jpg', { type: 'image/jpeg' }),
      { maxSizeMB: 0.7, maxWidthOrHeight: 2200, useWebWorker: true, initialQuality: 0.85 },
    )

    const coords = await getLocation()

    const fd = new FormData()
    fd.append('event_id', props.eventId)
    fd.append('file', compressed, 'photo.jpg')
    if (props.guestName) fd.append('guest_name', props.guestName)
    if (props.guestTable) fd.append('guest_table', String(props.guestTable))
    if (coords) {
      fd.append('guest_lat', String(coords.latitude))
      fd.append('guest_lng', String(coords.longitude))
    }

    const res = await uploadWithProgress<{ ok: boolean; photo_id: string; uploaded_at: string }>(
      '/api/guest/upload',
      fd,
      (pct) => { uploadPercent.value = pct },
    )

    if (!res.ok || !res.data) {
      throw { code: res.error?.code ?? 'upload_failed' }
    }

    emit('uploaded', { id: res.data.photo_id, uploaded_at: res.data.uploaded_at })
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
    lastBlob.value = null
    state.value = 'live'
  } catch (e: any) {
    state.value = 'review'
    error.value = e?.code ?? e?.data?.data?.code ?? 'upload_failed'
  }
}

watch(
  () => state.value,
  () => {},
)

onBeforeUnmount(() => {
  if (stream.value) stream.value.getTracks().forEach((t) => t.stop())
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})

const errorMessage = computed(() => {
  if (!error.value) return null
  const map: Record<string, string> = {
    permission_denied: 'Разрешите доступ к камере в настройках браузера, иначе мы не сможем снимать.',
    camera_unavailable: 'Не удалось включить камеру. Попробуйте перезагрузить страницу.',
    outside_window: 'Загрузка фото открывается только в день свадьбы.',
    outside_geofence: 'Вы слишком далеко от места свадьбы. Загрузка фото доступна только на площадке.',
    event_not_active: 'Событие пока не активно — попробуйте позже.',
    event_not_found: 'Событие не найдено.',
    file_too_large: 'Фото слишком тяжёлое. Попробуйте ещё раз — мы автоматически уменьшим размер.',
    unsupported_mime: 'Этот формат фото не поддерживается.',
    upload_failed: 'Не удалось отправить фото. Проверьте интернет и попробуйте снова.',
  }
  return map[error.value] ?? 'Что-то пошло не так. Попробуйте снова.'
})
</script>

<template>
  <div class="relative">
    <!-- Hidden canvas — used only to convert video frame to blob -->
    <canvas ref="canvasEl" class="hidden" />

    <!-- IDLE: pre-permission entry -->
    <div v-if="state === 'idle'" class="grid place-items-center p-6">
      <button
        type="button"
        class="group relative inline-flex h-14 items-center justify-center gap-2 overflow-hidden rounded-full bg-(--color-primary) px-8 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90"
        @click="startCamera"
      >
        <Camera class="h-5 w-5" :stroke-width="1.8" />
        <span>Открыть камеру</span>
      </button>
      <p class="mt-3 max-w-xs text-center text-xs text-(--color-muted-foreground)">
        Браузер попросит разрешение на камеру — нажмите «Разрешить».
      </p>
    </div>

    <!-- LIVE / REVIEW / UPLOADING viewport -->
    <div
      v-else-if="state !== 'error'"
      class="relative overflow-hidden rounded-(--radius-xl) border border-(--color-border)/60 bg-black"
      style="aspect-ratio: 3/4"
    >
      <!-- Live video -->
      <video
        v-show="state === 'live' || state === 'capturing'"
        ref="videoEl"
        playsinline
        muted
        class="h-full w-full object-cover"
      />

      <!-- Review preview -->
      <img
        v-if="state === 'review' || state === 'uploading'"
        :src="previewUrl ?? ''"
        alt=""
        class="h-full w-full object-cover"
      >

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
        <p class="mt-3 text-sm">Отправляем…</p>
      </div>

      <!-- Bottom controls bar -->
      <div class="absolute inset-x-0 bottom-0 grid grid-cols-3 items-center gap-4 bg-gradient-to-t from-black/70 to-transparent p-4">
        <!-- Live: flip camera -->
        <button
          v-if="state === 'live'"
          type="button"
          aria-label="Сменить камеру"
          class="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          @click="flipCamera"
        >
          <RefreshCw class="h-5 w-5" :stroke-width="1.8" />
        </button>

        <!-- Review: retake -->
        <button
          v-else-if="state === 'review'"
          type="button"
          aria-label="Переснять"
          class="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
          @click="retake"
        >
          <X class="h-5 w-5" :stroke-width="1.8" />
        </button>

        <div v-else />

        <!-- Center button: shutter (live) or send (review) -->
        <div class="grid place-items-center">
          <button
            v-if="state === 'live'"
            type="button"
            aria-label="Снять"
            class="h-16 w-16 rounded-full border-4 border-white/80 bg-white shadow-[0_0_0_4px_rgb(0_0_0_/_0.2)] transition-transform active:scale-95"
            @click="capture"
          />
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

    <!-- ERROR state -->
    <div v-else class="surface-card rounded-(--radius-xl) p-6 text-center">
      <p class="font-medium text-red-700">{{ errorMessage }}</p>
      <button
        type="button"
        class="mt-4 inline-flex h-11 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-white hover:opacity-90"
        @click="startCamera"
      >Попробовать снова</button>
    </div>

    <!-- Inline error toast under viewport (non-fatal) -->
    <p v-if="errorMessage && state !== 'error'" class="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ errorMessage }}
    </p>
  </div>
</template>
