<script setup lang="ts">
import { motion } from 'motion-v'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useSwitchLocalePath } from '#imports'

definePageMeta({ layout: 'guest' })

const { t, locale } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const otherLocale = computed<'ru' | 'uz'>(() => (locale.value === 'ru' ? 'uz' : 'ru'))
const otherLocaleLabel = computed(() => (locale.value === 'ru' ? 'O\'zbekcha' : 'Русский'))

/**
 * /e/[id] — public landing for wedding guests.
 *
 * Flow (per device):
 *   1. Scan QR → land here with `?t=N` (table number baked into the QR).
 *   2. We generate / read a persistent device_id (localStorage) and ask
 *      the server for the existing binding. Three branches:
 *        a) No binding yet → show welcome card (only "your name"),
 *           table is locked from the URL and displayed as a gold badge.
 *        b) Binding matches `t` → skip welcome, jump straight to
 *           camera with the stored name.
 *        c) Binding to a different table → polite "device already
 *           locked" screen; can't switch by rescanning.
 *   3. Camera/video/voice components get device_id + table; every
 *      upload counts against a per-device quota (see DEVICE_LIMITS).
 *
 * The table number can NEVER be edited from the UI any more — it is
 * strictly the one written into the QR code by the admin.
 */
const route = useRoute()
const eventId = computed(() => route.params.id as string)
const tableParam = computed(() => {
  const t = route.query.t
  const n = typeof t === 'string' ? parseInt(t, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
})

const { id: deviceId, ensure: ensureDeviceId } = useDeviceId()

interface Binding {
  table_number: number
  guest_name: string | null
  photo_count: number
  video_count: number
  voice_count: number
}

interface EventResp {
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
  binding: Binding | null
  limits: { photo: number, video: number, voice: number }
}

// Initial fetch (SSR-safe): no device_id, so we won't get a binding —
// that's fine. We re-fetch on mount once the device_id is known.
const { data, error: fetchError, pending, refresh } = await useFetch<EventResp>(
  () => `/api/guest/event/${eventId.value}`,
)

const ev = computed(() => data.value?.event ?? null)
const binding = ref<Binding | null>(data.value?.binding ?? null)
const limits = ref(data.value?.limits ?? { photo: 15, video: 3, voice: 3 })
watch(
  () => data.value,
  (next) => {
    if (next?.binding)
      binding.value = next.binding
    if (next?.limits)
      limits.value = next.limits
  },
)

const isActive = computed(() => ev.value?.status === 'active')
const isDraft = computed(() => ev.value?.status === 'draft')
const geofenceEnabled = computed(() => ev.value?.venue_lat != null && ev.value?.venue_lng != null)

const guestName = ref('')
const stage = ref<'welcome' | 'camera' | 'wrong_table' | 'no_table' | 'quota_full'>('welcome')

type Mode = 'photo' | 'video' | 'voice'
const mode = ref<Mode>('photo')

const showVideo = computed(() => ['pro', 'premium', 'luxury'].includes(ev.value?.plan_tier ?? ''))
const showVoice = computed(() => ['premium', 'luxury'].includes(ev.value?.plan_tier ?? ''))

const uploads = ref<Array<{ id: string, uploaded_at: string }>>([])

// Counters drive the "X / N" chips on the camera screen. Start from the
// last value the server returned; each upload bumps them.
const counts = ref({
  photo_count: binding.value?.photo_count ?? 0,
  video_count: binding.value?.video_count ?? 0,
  voice_count: binding.value?.voice_count ?? 0,
})
watch(binding, (b) => {
  if (b) {
    counts.value = {
      photo_count: b.photo_count,
      video_count: b.video_count,
      voice_count: b.voice_count,
    }
  }
})

// Helpers driving the active-mode progress strip in the header. The
// strip shows whatever the user is currently doing (photo / video /
// voice) so the most relevant quota is always front-and-centre; the
// other modes' counts stay visible as small numbers next to their
// dock tabs.
const activeIcon = computed(() => (mode.value === 'photo' ? '📸' : mode.value === 'video' ? '🎥' : '🎤'))
const activeUsed = computed(() => {
  if (mode.value === 'photo')
    return counts.value.photo_count
  if (mode.value === 'video')
    return counts.value.video_count
  return counts.value.voice_count
})
const activeLimit = computed(() => {
  if (mode.value === 'photo')
    return limits.value.photo
  if (mode.value === 'video')
    return limits.value.video
  return limits.value.voice
})
const activeProgress = computed(() => {
  const lim = activeLimit.value || 1
  return Math.min(100, (activeUsed.value / lim) * 100)
})
const activeLabel = computed(() => {
  if (mode.value === 'photo')
    return t('guest.camera.quotaPhotos', { used: activeUsed.value, total: activeLimit.value })
  if (mode.value === 'video')
    return t('guest.camera.quotaVideos', { used: activeUsed.value, total: activeLimit.value })
  return t('guest.camera.quotaVoices', { used: activeUsed.value, total: activeLimit.value })
})

function modeTabClass(m: Mode): string {
  return [
    'flex flex-1 flex-col items-center gap-0.5 rounded-full px-2 py-2 text-xs transition-colors',
    mode.value === m
      ? 'bg-(--color-primary) text-(--color-primary-foreground)'
      : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
  ].join(' ')
}

// Initial routing decision once we know device_id, table, and binding.
function decideStage() {
  if (!tableParam.value) {
    stage.value = 'no_table'
    return
  }
  if (binding.value && binding.value.table_number !== tableParam.value) {
    stage.value = 'wrong_table'
    return
  }
  if (binding.value) {
    // We already know this guest. Carry forward their name and skip
    // the welcome form entirely.
    if (binding.value.guest_name)
      guestName.value = binding.value.guest_name
    stage.value = 'camera'
    return
  }
  stage.value = 'welcome'
}

onMounted(async () => {
  ensureDeviceId()
  // Re-fetch the event WITH device_id so the server can attach the
  // existing binding (the SSR pass didn't have device_id yet).
  if (deviceId.value) {
    try {
      const fresh = await $fetch<EventResp>(`/api/guest/event/${eventId.value}`, {
        query: { device_id: deviceId.value },
      })
      binding.value = fresh.binding
      limits.value = fresh.limits
    }
    catch {
      // swallow — we still have the SSR response; binding stays null
    }
  }
  decideStage()
})

watch([tableParam, binding], decideStage)

const welcomePending = ref(false)

async function startCapture() {
  if (welcomePending.value)
    return
  if (!guestName.value.trim() || !tableParam.value || !deviceId.value)
    return
  welcomePending.value = true
  // Persist locally as a UX nicety.
  try {
    localStorage.setItem(`memour:guest:${eventId.value}`, guestName.value.trim())
  }
  catch { /* ignore */ }

  // Record the binding on the server NOW, not on first upload. This
  // way a guest who scans, enters their name, then closes the tab
  // (or wanders off and comes back later) jumps straight back to
  // the camera — the server already knows who they are.
  try {
    const res = await $fetch<{ ok: boolean, binding: Binding }>(
      `/api/guest/binding/${eventId.value}`,
      {
        method: 'POST',
        body: {
          device_id: deviceId.value,
          guest_name: guestName.value.trim(),
          guest_table: tableParam.value,
        },
      },
    )
    binding.value = res.binding
    counts.value = {
      photo_count: res.binding.photo_count,
      video_count: res.binding.video_count,
      voice_count: res.binding.voice_count,
    }
    stage.value = 'camera'
  }
  catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    if (code === 'wrong_table') {
      // Stale binding for this device points at a different table —
      // server-side check beats client-side guesswork.
      stage.value = 'wrong_table'
    }
    else {
      // Soft failure (network blip, server hiccup): let them in
      // anyway. The upload endpoint also creates the binding as a
      // safety net, so they're not stranded.
      console.error('[guest/welcome] binding failed', e)
      stage.value = 'camera'
    }
  }
  finally {
    welcomePending.value = false
  }
}

function onUploaded(photo: {
  id: string
  uploaded_at: string
  counts?: { photo_count: number, video_count: number, voice_count: number }
}) {
  uploads.value = [{ id: photo.id, uploaded_at: photo.uploaded_at }, ...uploads.value].slice(0, 12)
  if (photo.counts)
    counts.value = photo.counts
}

function onQuotaExceeded() {
  // Refresh binding state then drop the user into the "all out" screen.
  if (deviceId.value) {
    $fetch<EventResp>(`/api/guest/event/${eventId.value}`, {
      query: { device_id: deviceId.value },
    }).then((r) => {
      binding.value = r.binding
      counts.value = {
        photo_count: r.binding?.photo_count ?? counts.value.photo_count,
        video_count: r.binding?.video_count ?? counts.value.video_count,
        voice_count: r.binding?.voice_count ?? counts.value.voice_count,
      }
    }).catch(() => {})
  }
  // Force the user out of capture so the soft "everything used" screen
  // shows up immediately for the kind they just hit.
  stage.value = 'quota_full'
}

function onWrongTable() {
  // Server says this device is bound to a different table than the QR
  // they just scanned. Refresh the binding so we can show the correct
  // "locked to table N" message.
  if (deviceId.value) {
    $fetch<EventResp>(`/api/guest/event/${eventId.value}`, {
      query: { device_id: deviceId.value },
    }).then((r) => {
      binding.value = r.binding
      stage.value = 'wrong_table'
    }).catch(() => {})
  }
}

// Build a small monogram from "Albert & Anna" → "A & A". Splits on
// `&`, `·`, `+`, " и " (Russian and), " va " (Uzbek and), " and "
// (English) so couple_names entered in any of the three languages
// gives a clean two-letter result.
const monogram = computed(() => {
  const raw = ev.value?.couple_names ?? ''
  const parts = raw
    .split(/\s*[&·+]\s*|\s+и\s+|\s+va\s+|\s+and\s+/i)
    .map(s => s.trim())
    .filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]?.toUpperCase() ?? ''} & ${parts[1]![0]?.toUpperCase() ?? ''}`
  }
  return raw.slice(0, 2).toUpperCase()
})

const formattedDate = computed(() => {
  if (!ev.value?.wedding_date)
    return null
  // Locale-aware date — Cyrillic month names in RU, Latin in UZ.
  const tag = locale.value === 'uz' ? 'uz-UZ' : 'ru-RU'
  return new Date(ev.value.wedding_date).toLocaleDateString(tag, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
})

useSeoMeta({
  title: () => (ev.value?.couple_names ? `Memour · ${ev.value.couple_names}` : 'Memour'),
  description: () => t('guest.seo.description'),
})
</script>

<template>
  <!-- 404 -->
  <div v-if="fetchError" class="grid min-h-[100dvh] place-items-center p-6">
    <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
      <h1 class="heading-display-md">
        {{ t('guest.state.notFoundTitle') }}
      </h1>
      <p class="mt-2 text-(--color-muted-foreground)">
        {{ t('guest.state.notFoundDesc') }}
      </p>
    </div>
  </div>

  <div v-else-if="pending" class="grid min-h-[100dvh] place-items-center">
    <div class="text-(--color-muted-foreground)">
      {{ t('guest.state.loading') }}
    </div>
  </div>

  <!-- Draft -->
  <div v-else-if="isDraft" class="grid min-h-[100dvh] place-items-center p-6">
    <div class="surface-card max-w-md rounded-(--radius-xl) p-8 text-center">
      <p class="text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
        {{ ev?.couple_names }}
      </p>
      <h1 class="heading-display-md mt-3">
        {{ t('guest.state.draftTitle') }}
      </h1>
      <p class="mt-3 text-(--color-muted-foreground)">
        {{ t('guest.state.draftDesc') }}
      </p>
    </div>
  </div>

  <!-- ============================================================ -->
  <!--  ACTIVE EVENT — CAMERA STAGE: full-screen 3-zone layout       -->
  <!--                                                                -->
  <!--  Built around the thumb: identity + active-mode progress at    -->
  <!--  the top (only-read, never tap), the capture component fills   -->
  <!--  the middle, and every interactive element (mode switcher,    -->
  <!--  primary CTA, language switch) lives inside the bottom dock    -->
  <!--  pinned to the safe-area-aware bottom edge.                    -->
  <!-- ============================================================ -->
  <div
    v-else-if="isActive && ev && stage === 'camera' && tableParam && deviceId"
    class="flex min-h-[100dvh] flex-col"
    :style="ev.branding?.accent_color
      ? { '--color-primary': ev.branding.accent_color } as Record<string, string>
      : undefined"
  >
    <!-- No header on the capture screen — every pixel goes to the
         viewport. Identity was set on the welcome screen, language
         was picked there too, and each per-mode quota already lives
         on its corresponding dock tab below. -->
    <div class="h-3 shrink-0" />

    <!-- MAIN — capture component fills remaining height. The
         component owns its idle illustration + capture button; this
         wrapper just gives it room and a max-width on tablets.
         `min-h-0` is the magic bit: without it, flex children with
         intrinsic content (e.g. a <video> tag) refuse to shrink
         below their content size and the whole page picks up a
         scrollbar on shorter phones. -->
    <main class="flex flex-1 flex-col min-h-0">
      <div class="mx-auto flex w-full max-w-md flex-1 flex-col min-h-0 px-4 pt-3 pb-2">
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
            :device-id="deviceId"
            :guest-name="guestName"
            :guest-table="tableParam"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
            @quota_exceeded="onQuotaExceeded"
            @wrong_table="onWrongTable"
          />
          <GuestVideo
            v-else-if="mode === 'video'"
            key="video"
            :event-id="ev.id"
            :device-id="deviceId"
            :guest-name="guestName"
            :guest-table="tableParam"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
            @quota_exceeded="onQuotaExceeded"
            @wrong_table="onWrongTable"
          />
          <GuestVoice
            v-else-if="mode === 'voice'"
            key="voice"
            :event-id="ev.id"
            :device-id="deviceId"
            :guest-name="guestName"
            :guest-table="tableParam"
            :geofence-enabled="geofenceEnabled"
            @uploaded="onUploaded"
            @quota_exceeded="onQuotaExceeded"
            @wrong_table="onWrongTable"
          />
        </Transition>
      </div>
    </main>

    <!-- DOCK — mode switcher only now. Each tab carries its own
         N/M readout so the user can switch modes without leaving the
         dock and confirms the count at a glance. Language link lives
         in the header so this row stays focused on capture controls. -->
    <footer
      class="sticky bottom-0 z-30 mx-auto w-full max-w-md shrink-0 border-t border-(--color-border)/40 bg-(--color-background)/95 px-4 pt-2.5 backdrop-blur"
      :style="{ paddingBottom: 'max(env(safe-area-inset-bottom), 10px)' }"
    >
      <div v-if="showVideo || showVoice" class="flex items-center gap-1 rounded-full border border-(--color-border) bg-white p-1 shadow-[0_2px_8px_rgb(0_0_0_/_0.04)]">
        <button type="button" :class="modeTabClass('photo')" @click="mode = 'photo'">
          <span class="text-sm leading-none">📸</span>
          <span class="text-[10px] uppercase tracking-wider opacity-80">{{ counts.photo_count }}/{{ limits.photo }}</span>
        </button>
        <button v-if="showVideo" type="button" :class="modeTabClass('video')" @click="mode = 'video'">
          <span class="text-sm leading-none">🎥</span>
          <span class="text-[10px] uppercase tracking-wider opacity-80">{{ counts.video_count }}/{{ limits.video }}</span>
        </button>
        <button v-if="showVoice" type="button" :class="modeTabClass('voice')" @click="mode = 'voice'">
          <span class="text-sm leading-none">🎤</span>
          <span class="text-[10px] uppercase tracking-wider opacity-80">{{ counts.voice_count }}/{{ limits.voice }}</span>
        </button>
      </div>
    </footer>
  </div>

  <!-- ============================================================ -->
  <!--  ACTIVE EVENT — non-camera stages (welcome, errors, quota)    -->
  <!--                                                                -->
  <!--  Card-centric, scrolling layout. Cover photo at top, content   -->
  <!--  card in the middle, language switch as a quiet text link at   -->
  <!--  the bottom of the column so it never overlaps content.       -->
  <!-- ============================================================ -->
  <div
    v-else-if="isActive && ev"
    class="relative mx-auto max-w-md px-4 pb-12 pt-4 sm:pt-10"
    :style="ev.branding?.accent_color
      ? { '--color-primary': ev.branding.accent_color } as Record<string, string>
      : undefined"
  >
    <!-- Cover hero — present on welcome / locked-state screens -->
    <div
      v-if="ev.branding?.cover_photo"
      class="relative -mx-4 aspect-[4/3] overflow-hidden sm:rounded-(--radius-xl)"
    >
      <img :src="ev.branding.cover_photo" alt="" class="h-full w-full object-cover">
      <div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-(--color-background) via-(--color-background)/85 to-transparent" />
    </div>

    <Transition
      enter-active-class="transition duration-500"
      enter-from-class="opacity-0 translate-y-3"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
      mode="out-in"
    >
      <!-- ============== WELCOME ============== -->
      <div v-if="stage === 'welcome'" key="welcome">
        <!-- Monogram disc + names -->
        <motion.div
          :initial="{ opacity: 0, y: 16 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
          class="relative -mt-12 text-center"
        >
          <div class="mx-auto inline-flex h-24 w-24 items-center justify-center rounded-full border border-(--color-border) bg-(--color-background) shadow-[0_8px_28px_rgb(0_0_0_/_0.08)]">
            <span class="font-display text-2xl italic text-gradient-gold">{{ monogram }}</span>
          </div>
          <p class="mt-5 text-[10px] uppercase tracking-[0.42em] text-(--color-muted-foreground)">
            {{ t('guest.welcome.eyebrow') }}
          </p>
          <h1 class="mt-2 font-display text-[2rem] leading-tight italic">
            <span class="text-gradient-gold">{{ ev.couple_names }}</span>
          </h1>
          <p v-if="formattedDate" class="mt-1 text-sm italic text-(--color-muted-foreground)">
            {{ formattedDate }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
          </p>
          <div class="mt-5 flex items-center justify-center gap-3 text-(--color-muted-foreground)">
            <span class="h-px w-12 bg-gradient-to-r from-transparent via-(--color-border) to-(--color-border)" />
            <span class="text-amber-700">✦</span>
            <span class="h-px w-12 bg-gradient-to-l from-transparent via-(--color-border) to-(--color-border)" />
          </div>
        </motion.div>

        <!-- BIG GOLD TABLE BADGE -->
        <motion.div
          v-if="tableParam"
          :initial="{ opacity: 0, scale: 0.92 }"
          :animate="{ opacity: 1, scale: 1 }"
          :transition="{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }"
          class="mt-8 flex justify-center"
        >
          <div class="relative inline-flex flex-col items-center rounded-full border border-amber-200/60 bg-gradient-to-br from-amber-50 via-[#fdf6e3] to-amber-100 px-12 py-5 shadow-[0_10px_36px_rgb(180_130_60_/_0.18)]">
            <span class="text-[10px] uppercase tracking-[0.4em] text-amber-700/80">{{ t('guest.welcome.tableEyebrow') }}</span>
            <span class="font-display text-5xl italic leading-none text-amber-900">№ {{ tableParam }}</span>
          </div>
        </motion.div>

        <!-- Greeting -->
        <p class="mx-auto mt-6 max-w-sm text-center text-sm italic text-(--color-muted-foreground)">
          {{ ev.branding?.greeting_text || t('guest.welcome.greetingDefault') }}
        </p>

        <!-- Name input card -->
        <motion.div
          :initial="{ opacity: 0, y: 12 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }"
          class="mt-8 rounded-(--radius-xl) border border-(--color-border)/60 bg-white/90 p-6 backdrop-blur"
        >
          <label class="block text-center text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">
            {{ t('guest.welcome.nameQuestion') }}
          </label>
          <input
            v-model="guestName"
            type="text"
            maxlength="80"
            :placeholder="t('guest.welcome.namePlaceholder')"
            autofocus
            class="mt-3 h-12 w-full rounded-md border border-(--color-border)/70 bg-(--color-background) px-4 text-center text-base placeholder:text-(--color-muted-foreground)/60 focus-visible:border-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200/60"
            @keydown.enter="startCapture"
          >
          <button
            type="button"
            :disabled="!guestName.trim() || welcomePending"
            class="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-(--color-primary) text-sm font-medium tracking-wide text-(--color-primary-foreground) shadow-(--shadow-soft) transition-opacity hover:opacity-90 disabled:opacity-40"
            @click="startCapture"
          >
            {{ welcomePending ? t('guest.camera.uploadingShort') : t('guest.welcome.openCamera') }}
          </button>
          <p class="mt-3 text-center text-[11px] leading-relaxed text-(--color-muted-foreground)">
            {{ t('guest.welcome.nameHint') }}
          </p>
        </motion.div>
      </div>

      <!-- ============== NO TABLE IN URL ============== -->
      <div v-else-if="stage === 'no_table'" key="no_table" class="-mt-10 text-center">
        <div class="surface-card rounded-(--radius-xl) p-8">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50">
            <span class="text-2xl">⌫</span>
          </div>
          <h2 class="mt-4 font-display text-2xl italic">
            {{ t('guest.noTable.title') }}
          </h2>
          <p class="mt-2 text-sm text-(--color-muted-foreground)">
            {{ t('guest.noTable.desc') }}
          </p>
        </div>
      </div>

      <!-- ============== DEVICE LOCKED TO ANOTHER TABLE ============== -->
      <div v-else-if="stage === 'wrong_table' && binding" key="wrong_table" class="-mt-10 text-center">
        <div class="surface-card rounded-(--radius-xl) p-8">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
            <span class="text-xl">⊘</span>
          </div>
          <h2 class="mt-4 font-display text-2xl italic">
            {{ t('guest.wrongTable.title') }}
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
            {{ t('guest.wrongTable.descBefore') }}
            <strong class="font-medium text-(--color-foreground)">{{ t('guest.wrongTable.tableLabel', { n: binding.table_number }) }}</strong>.
            {{ t('guest.wrongTable.descAfter') }}
          </p>
          <p class="mt-3 text-xs italic text-(--color-muted-foreground)">
            {{ t('guest.wrongTable.currentScan', { table: tableParam }) }}
          </p>
        </div>
      </div>

      <!-- ============== QUOTA FULL ============== -->
      <div v-else-if="stage === 'quota_full'" key="quota_full" class="-mt-10 text-center">
        <div class="surface-card rounded-(--radius-xl) p-8">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
            <span class="text-xl">✓</span>
          </div>
          <h2 class="mt-4 font-display text-2xl italic">
            {{ t('guest.quotaFull.title') }}
          </h2>
          <p class="mt-3 text-sm leading-relaxed text-(--color-muted-foreground)">
            {{ t('guest.quotaFull.desc') }}
          </p>
          <div class="mt-5 grid grid-cols-3 gap-3 text-center">
            <div class="rounded-md border border-(--color-border)/60 bg-white/70 px-2 py-3">
              <p class="text-[9px] uppercase tracking-widest text-(--color-muted-foreground)">
                {{ t('guest.quotaFull.photo') }}
              </p>
              <p class="mt-1 font-display text-lg">
                {{ counts.photo_count }}<span class="text-(--color-muted-foreground)">/{{ limits.photo }}</span>
              </p>
            </div>
            <div v-if="showVideo" class="rounded-md border border-(--color-border)/60 bg-white/70 px-2 py-3">
              <p class="text-[9px] uppercase tracking-widest text-(--color-muted-foreground)">
                {{ t('guest.quotaFull.video') }}
              </p>
              <p class="mt-1 font-display text-lg">
                {{ counts.video_count }}<span class="text-(--color-muted-foreground)">/{{ limits.video }}</span>
              </p>
            </div>
            <div v-if="showVoice" class="rounded-md border border-(--color-border)/60 bg-white/70 px-2 py-3">
              <p class="text-[9px] uppercase tracking-widest text-(--color-muted-foreground)">
                {{ t('guest.quotaFull.voice') }}
              </p>
              <p class="mt-1 font-display text-lg">
                {{ counts.voice_count }}<span class="text-(--color-muted-foreground)">/{{ limits.voice }}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Language switch — quiet text link at the foot of every
         non-camera state. Doesn't compete with content; one tap
         swaps the locale prefix on the current path so the ?t=
         query (the table the guest scanned) survives. -->
    <div class="mt-10 flex justify-center">
      <NuxtLink
        :to="switchLocalePath(otherLocale)"
        class="inline-flex items-center gap-1.5 text-[11px] text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
        :aria-label="otherLocaleLabel"
      >
        <svg viewBox="0 0 24 24" class="h-3 w-3 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7h13l-3-3" />
          <path d="M21 17H8l3 3" />
        </svg>
        {{ otherLocaleLabel }}
      </NuxtLink>
    </div>
  </div>
</template>
