<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { motion } from 'motion-v'

definePageMeta({ layout: 'guest' })

/**
 * /e/[id] — public landing for wedding guests.
 *
 * Flow:
 *   1. Welcome screen: couple names + greeting + name-ask prompt
 *      (table number pre-filled from ?t={N} in the QR code).
 *   2. Guest enters name once → stored in localStorage so a refresh
 *      doesn't ask again.
 *   3. Camera screen with the GuestCamera component.
 *   4. After each upload, show a thumb of recently sent photos.
 *
 * No auth. RLS-restricted event data fetched server-side via
 * /api/guest/event/[id].
 */
const route = useRoute()
const eventId = computed(() => route.params.id as string)
const tableParam = computed(() => {
  const t = route.query.t
  const n = typeof t === 'string' ? parseInt(t, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
})

// Fetch public event data via our server endpoint (RLS-safe).
const { data, error: fetchError, pending } = await useFetch<{
  event: {
    id: string
    couple_names: string
    wedding_date: string
    venue_name: string | null
    venue_lat: number | null
    venue_lng: number | null
    geofence_radius: number | null
    status: string
    plan_tier: string | null
    branding: {
      bride_name: string | null
      groom_name: string | null
      cover_photo: string | null
      accent_color: string | null
      greeting_text: string | null
    } | null
  }
}>(`/api/guest/event/${eventId.value}`)

const ev = computed(() => data.value?.event ?? null)
const isActive = computed(() => ev.value?.status === 'active')
const isDraft = computed(() => ev.value?.status === 'draft')
const geofenceEnabled = computed(() => ev.value?.venue_lat != null && ev.value?.venue_lng != null)

// Persisted guest identity. We don't want to ask name on every visit;
// localStorage keyed by event id so different events stay distinct.
const guestName = ref('')
const guestTable = ref<number | null>(tableParam.value)
const storageKey = computed(() => `memour:guest:${eventId.value}`)
const stage = ref<'welcome' | 'camera'>('welcome')

type Mode = 'photo' | 'video' | 'voice'
const mode = ref<Mode>('photo')

// Show video / voice tabs only when the tier supports them.
const showVideo = computed(() => ['pro', 'premium', 'luxury'].includes(ev.value?.plan_tier ?? ''))
const showVoice = computed(() => ['premium', 'luxury'].includes(ev.value?.plan_tier ?? ''))

const uploads = ref<Array<{ id: string; uploaded_at: string }>>([])

onMounted(() => {
  try {
    const raw = localStorage.getItem(storageKey.value)
    if (raw) {
      const saved = JSON.parse(raw) as { name?: string; table?: number }
      if (saved.name) guestName.value = saved.name
      if (saved.table && !guestTable.value) guestTable.value = saved.table
    }
  } catch {/* ignore */}
})

function startCapture() {
  try {
    localStorage.setItem(
      storageKey.value,
      JSON.stringify({ name: guestName.value, table: guestTable.value }),
    )
  } catch {/* ignore */}
  stage.value = 'camera'
}

function onUploaded(photo: { id: string; uploaded_at: string }) {
  uploads.value = [photo, ...uploads.value].slice(0, 12)
}

function changeIdentity() {
  stage.value = 'welcome'
}

useSeoMeta({
  title: () => (ev.value?.couple_names ? `Memour · ${ev.value.couple_names}` : 'Memour'),
  description: () => 'Загрузите фото со свадьбы — все кадры в одном альбоме.',
})
</script>

<template>
  <!-- Error / not-found / archived -->
  <div v-if="fetchError" class="grid min-h-[100dvh] place-items-center p-6">
    <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
      <h1 class="heading-display-md">Событие не найдено</h1>
      <p class="mt-2 text-(--color-muted-foreground)">
        Возможно, ссылка устарела или QR-код принадлежит другому событию.
      </p>
    </div>
  </div>

  <div v-else-if="pending" class="grid min-h-[100dvh] place-items-center">
    <div class="text-(--color-muted-foreground)">Загружаем…</div>
  </div>

  <!-- Draft state: event exists but not yet open for uploads -->
  <div v-else-if="isDraft" class="grid min-h-[100dvh] place-items-center p-6">
    <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
      <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">{{ ev?.couple_names }}</p>
      <h1 class="heading-display-md mt-3">Скоро будем готовы</h1>
      <p class="mt-3 text-(--color-muted-foreground)">
        Загрузка фото ещё не открыта. Возвращайтесь в день свадьбы.
      </p>
    </div>
  </div>

  <!-- Active event: welcome → camera -->
  <div
    v-else-if="isActive && ev"
    class="relative mx-auto max-w-md px-4 pb-10 pt-6 sm:pt-10"
    :style="ev.branding?.accent_color
      ? { '--color-primary': ev.branding.accent_color } as Record<string, string>
      : undefined"
  >
    <!-- Cover image as a hero band above the welcome card -->
    <div
      v-if="ev.branding?.cover_photo && stage === 'welcome'"
      class="relative -mx-4 mb-4 aspect-[4/3] overflow-hidden sm:rounded-(--radius-xl)"
    >
      <img :src="ev.branding.cover_photo" alt="" class="h-full w-full object-cover">
      <div class="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-(--color-background) to-transparent" />
    </div>
    <!-- WELCOME stage -->
    <Transition
      enter-active-class="transition duration-400"
      enter-from-class="opacity-0 translate-y-3"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
      mode="out-in"
    >
      <div v-if="stage === 'welcome'" key="welcome">
        <motion.div
          :initial="{ opacity: 0, y: 20 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
          class="text-center"
        >
          <p class="text-[10px] uppercase tracking-[0.4em] text-(--color-muted-foreground)">
            свадьба
          </p>
          <h1 class="heading-display-lg mt-2 italic">
            <span class="text-gradient-gold">{{ ev.couple_names }}</span>
          </h1>
          <p v-if="ev.branding?.greeting_text" class="mt-3 text-(--color-muted-foreground)">
            {{ ev.branding.greeting_text }}
          </p>
          <p v-else class="mt-3 text-(--color-muted-foreground)">
            Спасибо что разделили этот день с нами. Сфотографируйте всё что вас порадует — мы соберём в один альбом.
          </p>
          <div class="mt-4 flex items-center justify-center gap-3 text-(--color-muted-foreground)">
            <span class="h-px w-10 bg-(--color-border)" />
            <span class="text-xs">⋄</span>
            <span class="h-px w-10 bg-(--color-border)" />
          </div>
        </motion.div>

        <div class="mt-8 space-y-4 rounded-(--radius-xl) border border-(--color-border)/60 bg-white/80 p-5 backdrop-blur">
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
              Ваше имя
            </label>
            <input
              v-model="guestName"
              type="text"
              maxlength="80"
              placeholder="Например: Алиса"
              class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
            >
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
              Номер стола (по желанию)
            </label>
            <input
              v-model.number="guestTable"
              type="number"
              min="1"
              max="500"
              placeholder="—"
              class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
            >
          </div>
          <button
            type="button"
            class="inline-flex h-12 w-full items-center justify-center rounded-md bg-(--color-primary) text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90"
            @click="startCapture"
          >
            Открыть камеру
          </button>
          <p class="text-center text-[11px] text-(--color-muted-foreground)">
            Имя и номер стола подпишут ваши фото — это поможет паре их найти потом.
          </p>
        </div>
      </div>

      <!-- CAMERA stage -->
      <div v-else key="camera">
        <div class="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs text-(--color-muted-foreground) underline decoration-(--color-muted-foreground)/40 underline-offset-2"
            @click="changeIdentity"
          >Изменить имя</button>
          <div class="text-right text-xs text-(--color-muted-foreground)">
            <span v-if="guestName">{{ guestName }}</span>
            <span v-if="guestTable"> · стол {{ guestTable }}</span>
          </div>
        </div>

        <!-- Mode tabs — visible only when the tier unlocks them.
             Basic tier sees photos only, Pro adds video, Premium adds
             voice memo. -->
        <div v-if="showVideo || showVoice" class="mb-4 flex items-center gap-1 rounded-full border border-(--color-border) bg-white p-0.5">
          <button
            type="button"
            :class="[
              'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
              mode === 'photo'
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="mode = 'photo'"
          >📸 Фото</button>
          <button
            v-if="showVideo"
            type="button"
            :class="[
              'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
              mode === 'video'
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="mode = 'video'"
          >🎥 Видео</button>
          <button
            v-if="showVoice"
            type="button"
            :class="[
              'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
              mode === 'voice'
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="mode = 'voice'"
          >🎤 Голос</button>
        </div>

        <Transition
          enter-active-class="transition duration-300"
          enter-from-class="opacity-0 translate-x-2"
          enter-to-class="opacity-100"
          mode="out-in"
        >
          <GuestCamera
            v-if="mode === 'photo'"
            key="photo"
            :event-id="ev.id"
            :guest-name="guestName"
            :guest-table="guestTable"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
          />
          <GuestVideo
            v-else-if="mode === 'video'"
            key="video"
            :event-id="ev.id"
            :guest-name="guestName"
            :guest-table="guestTable"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
          />
          <GuestVoice
            v-else-if="mode === 'voice'"
            key="voice"
            :event-id="ev.id"
            :guest-name="guestName"
            :guest-table="guestTable"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
          />
        </Transition>

        <!-- Recently uploaded thumbs (success confirmation) -->
        <div v-if="uploads.length > 0" class="mt-6">
          <p class="mb-2 text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
            Отправлено · {{ uploads.length }}
          </p>
          <div class="grid grid-cols-6 gap-1.5">
            <div
              v-for="u in uploads"
              :key="u.id"
              class="aspect-square overflow-hidden rounded-md bg-gradient-to-br from-(--color-accent) to-(--color-rose)"
            />
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
