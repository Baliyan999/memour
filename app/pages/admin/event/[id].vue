<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { GUEST_LIMIT_WARN_AT, guestLimitForTier } from '#shared/plans'

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
 * is saved.
 */
const { t } = useI18n()
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
  guests: number
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

const guestLimit = computed(() => guestLimitForTier(plan_tier.value))
const guestsState = computed<'ok' | 'near' | 'full'>(() => {
  const n = ev?.guests ?? 0
  if (n >= guestLimit.value) return 'full'
  return n >= Math.ceil(guestLimit.value * GUEST_LIMIT_WARN_AT) ? 'near' : 'ok'
})

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

    <form v-else class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" novalidate @submit.prevent="submit">
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

      <div class="flex flex-col gap-1.5">
        <label for="ev-phone" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.couplePhone') }}</label>
        <template v-if="!claimed">
          <MarketingPhoneInput
            id="ev-phone"
            v-model="owner_phone"
            v-model:digits="owner_phone_digits"
          />
          <p class="text-[11px] text-(--color-muted-foreground)">
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
            class="text-[11px] tabular-nums"
            :class="guestsState === 'ok' ? 'text-(--color-muted-foreground)' : 'text-amber-700'"
            role="status"
          >
            {{ t('admin.eventForm.guests', { n: ev.guests, max: guestLimit }) }}<template v-if="guestsState !== 'ok'">.
              {{ t(guestsState === 'full' ? 'admin.eventForm.guestsFull' : 'admin.eventForm.guestsNear') }}</template>
          </p>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ev-status" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.status') }}</label>
          <select
            id="ev-status"
            v-model="status"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
            <option value="draft">{{ t('admin.eventForm.statusDraft') }}</option>
            <option value="active">{{ t('admin.eventForm.statusActive') }}</option>
            <option value="archived">{{ t('admin.eventForm.statusArchived') }}</option>
          </select>
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
