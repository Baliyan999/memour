<script setup lang="ts">
import { ref } from 'vue'
import { useLocalePath } from '#imports'
import { LEAD_TIERS, type LeadTier } from '#shared/lead'

definePageMeta({ layout: 'admin' })

/**
 * Admin — create event form. Posts to /api/admin/events which inserts
 * the row and links it to the couple through ONE login channel:
 *   - SMS (default): the couple's phone; their first SMS login
 *     auto-claims the event;
 *   - Email: for couples without an Uzbek number; they sign in at
 *     /dashboard/login with that address.
 *
 * Query params (when navigated from `/admin/leads → создать событие`):
 *   couple_names, owner_phone (9 digits, or 12 with the 998 prefix),
 *   wedding_date, table_count, plan_tier (picked on the site's Pricing
 *   card), from_lead — id of the originating lead; the server marks it
 *   converted + linked to the new event.
 *
 * The form checks its fields itself (novalidate — the browser's bubbles
 * speak the browser's language, and a prefilled value never triggers
 * minlength) with the server's limits, and shows the first problem
 * above the buttons.
 */
const localePath = useLocalePath()
const router = useRouter()
const route = useRoute()
const { toast } = useToast()
const errorMessage = useErrorMessage()
const { t } = useI18n()

const couple_names = ref('')
const wedding_date = ref<string | null>(null)
const venue_name = ref('')
const channel = ref<'phone' | 'email'>('phone')
const owner_email = ref('')
const owner_phone = ref('+998 ')
const owner_phone_digits = ref('')
const table_count = ref(10)
const plan_tier = ref<'basic' | 'pro' | 'premium' | 'luxury'>('basic')
const status = ref<'draft' | 'active'>('draft')
const fromLeadId = ref<string | null>(null)

// Prefill from query params (set by the /admin/leads → создать кнопка).
// Done in setup, not onMounted: <PhoneInput> copies its `digits` prop
// once when it's created, which happens before the parent's onMounted.
{
  const q = route.query
  if (typeof q.couple_names === 'string') couple_names.value = q.couple_names
  if (typeof q.wedding_date === 'string') wedding_date.value = q.wedding_date
  if (typeof q.owner_phone === 'string') {
    const d = q.owner_phone.replace(/\D/g, '').replace(/^998(?=\d{9}$)/, '')
    if (/^\d{9}$/.test(d)) {
      owner_phone_digits.value = d
      owner_phone.value = `+998 ${d}`
    }
  }
  if (typeof q.table_count === 'string') {
    const n = parseInt(q.table_count, 10)
    if (Number.isFinite(n)) table_count.value = Math.min(200, Math.max(1, n))
  }
  if (typeof q.plan_tier === 'string' && (LEAD_TIERS as readonly string[]).includes(q.plan_tier)) {
    plan_tier.value = q.plan_tier as LeadTier
  }
  if (typeof q.from_lead === 'string' && /^[0-9a-f-]{36}$/i.test(q.from_lead)) {
    fromLeadId.value = q.from_lead
  }
}

const pending = ref(false)
const error = ref<string | null>(null)

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

/** First invalid field → its code (same limits as /api/admin/events). */
function validate(): string | null {
  const names = couple_names.value.trim().length
  if (names < 2 || names > 120) return 'invalid_names'
  if (!wedding_date.value) return 'date_required'
  const tables = Number(table_count.value)
  if ((table_count.value as unknown) === '' || !Number.isInteger(tables) || tables < 1 || tables > 200) return 'invalid_table_count'
  if (channel.value === 'phone' && owner_phone_digits.value.length > 0 && owner_phone_digits.value.length < 9) return 'phone_incomplete'
  if (channel.value === 'email' && !EMAIL_RE.test(owner_email.value.trim())) return 'invalid_email'
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
    const res = await $fetch<{ ok: boolean; event: { id: string }; notified: boolean | 'skipped' | null }>(
      '/api/admin/events',
      {
        method: 'POST',
        body: {
          couple_names: couple_names.value,
          wedding_date: wedding_date.value,
          venue_name: venue_name.value || null,
          owner_email: channel.value === 'email' ? owner_email.value.trim() || null : null,
          owner_phone: channel.value === 'phone' && owner_phone_digits.value.length === 9
            ? `+998${owner_phone_digits.value}`
            : null,
          table_count: table_count.value,
          plan_tier: plan_tier.value,
          status: status.value,
          // The server marks the lead won + linked and credits the
          // referral partner in the same request.
          lead_id: fromLeadId.value,
        },
      },
    )
    if (res.ok) {
      // The event exists either way; just tell the admin the couple
      // didn't get the "cabinet is open" SMS (refused, or Eskiz test
      // mode where nothing is sent at all).
      if (res.notified === false) toast.error(t('errors.sms_notify_failed'))
      else if (res.notified === 'skipped') toast.info(t('admin.event.smsSkipped'), 8000)
      router.push(localePath('/admin'))
    }
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h1 class="heading-display-md mb-6">{{ t('admin.eventForm.createTitle') }}</h1>

    <form class="surface-card flex flex-col gap-5 rounded-(--radius-xl) p-7" novalidate @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <label for="ev-names" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.coupleNames') }}</label>
        <input
          id="ev-names"
          v-model="couple_names"
          type="text"
          maxlength="120"
          :placeholder="t('admin.eventForm.coupleNamesPlaceholder')"
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
          placeholder="Lokomotiv Wedding Hall"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.channel') }}</span>
        <div class="flex gap-1 rounded-full border border-(--color-border) bg-white p-0.5" role="radiogroup">
          <button
            v-for="c in (['phone', 'email'] as const)"
            :key="c"
            type="button"
            role="radio"
            :aria-checked="channel === c"
            :class="[
              'flex-1 rounded-full px-3 py-1.5 text-xs transition-colors',
              channel === c
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="channel = c"
          >{{ c === 'phone' ? t('admin.eventForm.bySms') : t('admin.eventForm.byEmail') }}</button>
        </div>
      </div>

      <div v-if="channel === 'phone'" class="flex flex-col gap-1.5">
        <label for="ev-phone" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.couplePhone') }}</label>
        <MarketingPhoneInput
          id="ev-phone"
          v-model="owner_phone"
          v-model:digits="owner_phone_digits"
        />
        <p class="text-[11px] text-(--color-muted-foreground)">
          {{ t('admin.eventForm.couplePhoneHint') }}
        </p>
      </div>

      <div v-else class="flex flex-col gap-1.5">
        <label for="ev-email" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">{{ t('admin.eventForm.coupleEmail') }}</label>
        <input
          id="ev-email"
          v-model="owner_email"
          type="email"
          autocomplete="off"
          maxlength="160"
          placeholder="couple@example.com"
          class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
        >
        <p class="text-[11px] text-(--color-muted-foreground)">
          {{ t('admin.eventForm.coupleEmailHint') }}
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
        >{{ pending ? t('admin.eventForm.creating') : t('admin.eventForm.create') }}</button>
      </div>
    </form>
  </div>
</template>
