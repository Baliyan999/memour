<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { GUEST_LIMIT_WARN_AT, guestLimitForTier } from '#shared/plans'
import { GEOFENCE_DEFAULT_RADIUS, formatLatLng, parseVenueLocation } from '#shared/geofence'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: 'admin' })

/**
 * Admin — edit an event after creation (PATCH /api/admin/events/[id]).
 *
 * Covers the two things the create form can't undo: typos that would
 * be printed on the QR cards (names, date, table count) and offline
 * payments (draft → active by hand). The couple's phone can be fixed
 * only until their first SMS login claims the event.
 *
 * Fields are checked here first (novalidate — the browser's bubbles
 * speak the browser's language) with the server's limits.
 *
 * Under the tier: guests so far against the limit of the tier picked
 * in the form (shared/plans.ts) — an upgrade raises it the moment it
 * is saved. Places held by phones that never sent a file can be given
 * back (DELETE …/idle-guests): the way out when a script or idle
 * phones filled the event and real guests are turned away.
 *
 * The soft geofence (<AdminGeofenceField>): switching it off clears the
 * venue point and the radius on the server.
 *
 * Above the form, "guest uploads" pauses and resumes guest uploads the
 * moment it is flipped (PATCH uploads_paused alone, not with Save): the
 * guest page shows a "paused" card, uploads get 423, the live slideshow
 * keeps running. An event whose media the retention task deleted
 * (purged_at) can't leave the archive: the other statuses are disabled
 * and the server refuses them too (409 cannot_reopen_purged).
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const router = useRouter()
const route = useRoute()
const { toast } = useToast()
const errorMessage = useErrorMessage()
const id = route.params.id as string

interface AdminEvent {
  id: string
  couple_names: string
  wedding_date: string
  venue_name: string | null
  status: 'draft' | 'active' | 'archived'
  plan_tier: 'basic' | 'pro' | 'premium' | 'luxury' | null
  owner_id: string | null
  owner_phone: string | null
  table_count: number | null
  venue_lat: number | null
  venue_lng: number | null
  geofence_radius: number | null
  uploads_paused: boolean
  purged_at: string | null
  guests: number
  idle_guests: number
}
const { data, error: loadError } = await useFetch<{ event: AdminEvent }>(`/api/admin/events/${id}`)

const ev = data.value?.event
const couple_names = ref(ev?.couple_names ?? '')
const wedding_date = ref<string | null>(ev?.wedding_date ?? null)
const venue_name = ref(ev?.venue_name ?? '')
const table_count = ref(ev?.table_count ?? 10)
const plan_tier = ref(ev?.plan_tier ?? 'basic')
const status = ref(ev?.status ?? 'draft')
// Set before <PhoneInput> is created — it reads `digits` only once.
const initialDigits = ev?.owner_phone?.replace(/^\+998/, '') ?? ''
const owner_phone_digits = ref(initialDigits)
const owner_phone = ref(`+998 ${initialDigits}`)
const claimed = !!ev?.owner_id
const hadGeofence = ev?.venue_lat != null && ev?.venue_lng != null
const geoEnabled = ref(hadGeofence)
const geoLocation = ref(hadGeofence ? formatLatLng({ lat: ev!.venue_lat!, lng: ev!.venue_lng! }) : '')
const geoRadius = ref<number>(ev?.geofence_radius ?? GEOFENCE_DEFAULT_RADIUS)
const purgedOn = ev?.purged_at ? formatDate(ev.purged_at, locale.value) : null

// Guest uploads: saved on its own as soon as it is flipped. The switch
// reads like its heading — on means guests can send, off means paused —
// moves at once and goes back if the server refuses.
const uploadsPaused = ref(ev?.uploads_paused ?? false)
const savingPause = ref(false)
async function togglePause() {
  if (savingPause.value) return
  const next = !uploadsPaused.value
  uploadsPaused.value = next
  savingPause.value = true
  try {
    await $fetch(`/api/admin/events/${id}`, { method: 'PATCH', body: { uploads_paused: next } })
    toast.success(t(next ? 'admin.eventForm.uploadsPausedToast' : 'admin.eventForm.uploadsResumedToast'))
  } catch (e) {
    uploadsPaused.value = !next
    toast.error(errorMessage(e))
  } finally {
    savingPause.value = false
  }
}

const guests = ref(ev?.guests ?? 0)
const idleGuests = ref(ev?.idle_guests ?? 0)
const guestLimit = computed(() => guestLimitForTier(plan_tier.value))
const guestsState = computed<'ok' | 'near' | 'full'>(() => {
  const n = guests.value
  if (n >= guestLimit.value) return 'full'
  return n >= Math.ceil(guestLimit.value * GUEST_LIMIT_WARN_AT) ? 'near' : 'ok'
})

const freeing = ref(false)
async function freeIdleGuests() {
  if (freeing.value) return
  const ok = await confirmDialog({
    title: t('admin.eventForm.freeIdleTitle'),
    description: t('admin.eventForm.freeIdleDesc', { n: idleGuests.value }),
    confirmLabel: t('admin.eventForm.freeIdleConfirm'),
    cancelLabel: t('common.cancel'),
    tone: 'danger',
  })
  if (!ok) return
  freeing.value = true
  try {
    const res = await $fetch<{ freed: number; guests: number }>(`/api/admin/events/${id}/idle-guests`, { method: 'DELETE' })
    guests.value = res.guests
    idleGuests.value = 0
    toast.success(t('admin.eventForm.freedIdle', { n: res.freed }))
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    freeing.value = false
  }
}

const pending = ref(false)
const error = ref<string | null>(null)

/** First invalid field → its code (same limits as PATCH /api/admin/events/[id]). */
function validate(): string | null {
  const names = couple_names.value.trim().length
  if (names < 2 || names > 120) return 'invalid_names'
  if (!wedding_date.value) return 'date_required'
  const tables = Number(table_count.value)
  if ((table_count.value as unknown) === '' || !Number.isInteger(tables) || tables < 1 || tables > 200) return 'invalid_table_count'
  if (!claimed && owner_phone_digits.value.length > 0 && owner_phone_digits.value.length < 9) return 'phone_incomplete'
  if (geoEnabled.value) {
    const venue = parseVenueLocation(geoLocation.value)
    if (!venue.ok) return venue.reason === 'empty' ? 'geofence_location_required' : 'geofence_location_invalid'
  }
  return null
}

async function submit() {
  if (pending.value) return
  const invalid = validate()
  if (invalid) {
    error.value = errorMessage(invalid)
    return
  }
  error.value = null
  pending.value = true
  try {
    const body: Record<string, unknown> = {
      couple_names: couple_names.value,
      wedding_date: wedding_date.value,
      venue_name: venue_name.value || null,
      table_count: table_count.value,
      plan_tier: plan_tier.value,
      status: status.value,
    }
    if (!claimed && owner_phone_digits.value.length === 9) {
      body.owner_phone = `+998${owner_phone_digits.value}`
    }
    const venue = parseVenueLocation(geoLocation.value)
    if (geoEnabled.value && venue.ok) {
      Object.assign(body, { venue_lat: venue.point.lat, venue_lng: venue.point.lng, geofence_radius: geoRadius.value })
    } else if (hadGeofence) {
      Object.assign(body, { venue_lat: null, venue_lng: null, geofence_radius: null })
    }
    await $fetch(`/api/admin/events/${id}`, { method: 'PATCH', body })
    toast.success(t('admin.eventForm.saved'))
    router.push(localePath('/admin'))
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h1 class="heading-display-md mb-6">{{ t('admin.eventForm.editTitle') }}</h1>

    <div v-if="loadError || !ev" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <p class="text-(--color-muted-foreground)" role="alert">{{ errorMessage(loadError ?? 'event_not_found') }}</p>
      <NuxtLink
        :to="localePath('/admin')"
        class="mt-4 inline-flex h-10 items-center rounded-md border border-(--color-border) bg-white px-5 text-sm hover:bg-(--color-muted)"
      >{{ t('admin.eventForm.backToEvents') }}</NuxtLink>
    </div>

    <section
      v-if="ev && !loadError"
      class="surface-card mb-4 flex items-start justify-between gap-4 rounded-(--radius-xl) px-7 py-5"
      aria-labelledby="ev-uploads-title"
    >
      <div class="min-w-0 flex-1">
        <h2 id="ev-uploads-title" class="font-sans text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.uploads') }}</h2>
        <p
          class="mt-1 text-sm leading-relaxed"
          :class="uploadsPaused ? 'text-amber-800' : 'text-(--color-muted-foreground)'"
          role="status"
        >{{ uploadsPaused ? t('admin.eventForm.uploadsPausedDesc') : t('admin.eventForm.uploadsOpenDesc') }}</p>
      </div>
      <button
        type="button"
        role="switch"
        data-testid="pause-switch"
        :aria-checked="!uploadsPaused"
        :aria-label="t('admin.eventForm.uploadsSwitchLabel')"
        :aria-busy="savingPause"
        :class="[
          'relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-(--spring-snappy) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) focus-visible:ring-offset-2',
          uploadsPaused ? 'bg-(--color-muted-foreground)/30' : 'bg-(--color-primary)',
        ]"
        @click="togglePause"
      >
        <span
          aria-hidden="true"
          :class="[
            'block h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0_/_0.2)] transition-transform duration-(--spring-snappy) ease-(--ease-spring) motion-reduce:transition-none',
            uploadsPaused ? 'translate-x-0' : 'translate-x-5',
          ]"
        />
      </button>
    </section>

    <form v-if="ev && !loadError" class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <label for="ev-names" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.coupleNames') }}</label>
        <input
          id="ev-names"
          v-model="couple_names"
          type="text"
          maxlength="120"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.weddingDate') }}</label>
          <MarketingDatePicker v-model="wedding_date" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ev-tables" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.tables') }}</label>
          <input
            id="ev-tables"
            v-model.number="table_count"
            type="number"
            inputmode="numeric"
            min="1"
            max="200"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
          >
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <label for="ev-venue" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.venue') }}</label>
        <input
          id="ev-venue"
          v-model="venue_name"
          type="text"
          maxlength="160"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
      </div>

      <AdminGeofenceField
        v-model:enabled="geoEnabled"
        v-model:location="geoLocation"
        v-model:radius="geoRadius"
      />

      <div class="flex flex-col gap-1.5">
        <label for="ev-phone" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.couplePhone') }}</label>
        <template v-if="!claimed">
          <MarketingPhoneInput
            id="ev-phone"
            v-model="owner_phone"
            v-model:digits="owner_phone_digits"
          />
          <p class="text-[0.6875rem] text-(--color-muted-foreground)">
            {{ t('admin.eventForm.phoneNotClaimedHint') }}
          </p>
        </template>
        <p v-else class="text-sm text-(--color-muted-foreground)">
          {{ ev.owner_phone ?? '—' }} · {{ t('admin.eventForm.phoneClaimed') }}
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="flex flex-col gap-1.5">
          <label for="ev-tier" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.tier') }}</label>
          <select
            id="ev-tier"
            v-model="plan_tier"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option v-for="tier in (['basic', 'pro', 'premium', 'luxury'] as const)" :key="tier" :value="tier">{{ t(`pricing.${tier}.name`) }}</option>
          </select>
          <p
            class="text-[0.6875rem] tabular-nums"
            :class="guestsState === 'ok' ? 'text-(--color-muted-foreground)' : 'text-amber-700'"
            role="status"
          >
            {{ t('admin.eventForm.guests', { n: guests, max: guestLimit }) }}<template v-if="guestsState !== 'ok'">.
              {{ t(guestsState === 'full' ? 'admin.eventForm.guestsFull' : 'admin.eventForm.guestsNear') }}</template>
          </p>
          <button
            v-if="idleGuests > 0"
            type="button"
            :disabled="freeing"
            class="self-start text-left text-[0.6875rem] text-(--color-foreground) underline decoration-(--color-border) underline-offset-2 hover:decoration-current disabled:opacity-60"
            @click="freeIdleGuests"
          >{{ t('admin.eventForm.freeIdle', { n: idleGuests }) }}</button>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ev-status" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.status') }}</label>
          <select
            id="ev-status"
            v-model="status"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option value="draft" :disabled="!!purgedOn">{{ t('admin.eventForm.statusDraft') }}</option>
            <option value="active" :disabled="!!purgedOn">{{ t('admin.eventForm.statusActive') }}</option>
            <option value="archived">{{ t('admin.eventForm.statusArchived') }}</option>
          </select>
          <p v-if="purgedOn" class="text-[0.6875rem] text-(--color-muted-foreground)">
            {{ t('admin.eventForm.purgedHint', { date: purgedOn }) }}
          </p>
        </div>
      </div>

      <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>

      <div class="flex gap-3">
        <NuxtLink
          :to="localePath('/admin')"
          class="inline-flex h-11 flex-1 items-center justify-center rounded-md border border-(--color-border) bg-white text-sm hover:bg-(--color-muted)"
        >{{ t('common.cancel') }}</NuxtLink>
        <button
          type="submit"
          :disabled="pending"
          class="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-(--color-primary) text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ pending ? t('admin.eventForm.saving') : t('admin.eventForm.save') }}</button>
      </div>
    </form>
  </div>
</template>
