<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { useI18n, useCookie, useState, useLocalePath } from '#imports'
import { useRoute } from 'vue-router'
import { motion, AnimatePresence } from 'motion-v'
import { Heart } from '@lucide/vue'
import { LEAD_LIMITS, LEAD_TIERS, REFERRAL_CODE_RE, type LeadTier } from '#shared/lead'

/**
 * LeadForm — RU/UZ-localized contact form. Sends a server call to
 * /api/lead which inserts into the leads table + pings Telegram.
 *
 * Validation is ours, not the browser's (`novalidate`): native bubbles
 * speak the browser's language, not the site's. The same limits the
 * server enforces (shared/lead.ts) are checked here first, and any
 * server code that still comes back is shown as errors.<code>.
 *
 * Referral tracking: if the visitor arrived via /?ref={code}, we
 * pass it along as `source: ref:{code}` so the admin attribution
 * report can match leads to partners. The code is also kept in a
 * 30-day cookie, so a trip through the logo link or a visit next week
 * still credits the partner.
 *
 * A Pricing CTA stores its tier in useState('leadTier'); the form shows
 * it above the button and sends it as `plan_tier`.
 *
 * The privacy-policy checkbox is required (never pre-ticked): the
 * server refuses a lead without it and records the consent.
 */
type Field = 'name' | 'phone' | 'wedding_date' | 'guests' | 'consent'

const { t, te, locale } = useI18n()
const route = useRoute()
const localePath = useLocalePath()
const { consentFor } = useLegal()

const refCookie = useCookie<string | null>('memour_ref', {
  maxAge: 60 * 60 * 24 * 30,
  sameSite: 'lax',
})
function cleanRef(r: unknown): string | null {
  if (typeof r !== 'string') return null
  const code = r.toLowerCase()
  return REFERRAL_CODE_RE.test(code) ? code : null
}
const queryRef = cleanRef(route.query.ref)
if (queryRef && refCookie.value !== queryRef) refCookie.value = queryRef
const referralCode = computed(() => cleanRef(route.query.ref) ?? cleanRef(refCookie.value))

const leadTier = useState<string | null>('leadTier', () => null)
const chosenTier = computed<LeadTier | null>(() =>
  (LEAD_TIERS as readonly string[]).includes(leadTier.value ?? '') ? leadTier.value as LeadTier : null)

const name = ref('')
const phone = ref('')
const phoneDigits = ref('')
const weddingDate = ref<string | null>(null)
const guests = ref<number | null>(null)
const consent = ref(false)
// Honeypot: hidden from people, filled by form bots (see template).
const hp = ref('')

const pending = ref(false)
const success = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<Partial<Record<Field, string>>>({})

const guestsRange = { min: LEAD_LIMITS.guestsMin, max: LEAD_LIMITS.guestsMax }

// Server codes that belong to one field; everything else is shown
// above the submit button.
const FIELD_OF: Record<string, Field> = {
  name_too_short: 'name',
  name_too_long: 'name',
  invalid_phone: 'phone',
  invalid_date: 'wedding_date',
  guests_out_of_range: 'guests',
  consent_required: 'consent',
}

function message(code: string): string {
  const key = `errors.${code}`
  if (!te(key)) return t('errors.generic')
  if (code === 'name_too_short') return t(key, { min: LEAD_LIMITS.nameMin })
  if (code === 'name_too_long') return t(key, { max: LEAD_LIMITS.nameMax })
  if (code === 'guests_out_of_range') return t(key, guestsRange)
  return t(key)
}

function validate(): Partial<Record<Field, string>> {
  const errs: Partial<Record<Field, string>> = {}
  const n = name.value.trim().length
  if (n === 0) errs.name = message('name_required')
  else if (n < LEAD_LIMITS.nameMin) errs.name = message('name_too_short')
  else if (n > LEAD_LIMITS.nameMax) errs.name = message('name_too_long')
  if (phoneDigits.value.length !== 9) errs.phone = message('phone_incomplete')
  const g = guests.value
  if (g != null && (g < LEAD_LIMITS.guestsMin || g > LEAD_LIMITS.guestsMax)) {
    errs.guests = message('guests_out_of_range')
  }
  if (!consent.value) errs.consent = message('consent_required')
  return errs
}

async function focusFirstInvalid() {
  await nextTick()
  const order: Field[] = ['name', 'phone', 'wedding_date', 'guests', 'consent']
  const first = order.find((f) => fieldErrors.value[f])
  if (first) document.getElementById(first === 'consent' ? 'lead-consent' : first)?.focus()
}

async function onSubmit() {
  // Enter in a field and a click on the button can both land before
  // the button re-renders as disabled.
  if (pending.value) return
  error.value = null
  fieldErrors.value = validate()
  if (Object.keys(fieldErrors.value).length) {
    focusFirstInvalid()
    return
  }

  pending.value = true
  try {
    await $fetch('/api/lead', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        phone: `+998${phoneDigits.value}`,
        wedding_date: weddingDate.value,
        guests_estimate: guests.value,
        source: referralCode.value ? `ref:${referralCode.value}` : 'landing',
        locale: locale.value,
        plan_tier: chosenTier.value ?? undefined,
        hp: hp.value || undefined,
        consent: consentFor('lead'),
      },
    })
    success.value = true
  } catch (e: any) {
    const { code } = errorInfo(e)
    const field = FIELD_OF[code]
    if (field) {
      fieldErrors.value = { [field]: message(code) }
      focusFirstInvalid()
    } else {
      error.value = message(code)
    }
  } finally {
    pending.value = false
  }
}

// Editing a field clears its message — the fix is in progress.
function clearError(field: Field) {
  if (fieldErrors.value[field]) {
    const { [field]: _, ...rest } = fieldErrors.value
    fieldErrors.value = rest
  }
}
watch(name, () => clearError('name'))
watch(phoneDigits, () => clearError('phone'))
watch(weddingDate, () => clearError('wedding_date'))
watch(guests, () => clearError('guests'))
watch(consent, () => clearError('consent'))
</script>

<template>
  <MarketingReveal class="mx-auto max-w-xl xl:max-w-2xl 2xl:max-w-3xl 3xl:max-w-4xl 4xl:max-w-5xl">
    <div class="surface-card relative rounded-(--radius-xl) p-6 sm:p-8 md:p-12 3xl:p-14 4xl:p-16">
      <!-- Decorative orbs in their own overflow-hidden layer so the
           calendar popup can escape -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-(--radius-xl)">
        <div aria-hidden="true" class="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-(--color-rose)/30 blur-3xl" />
        <div aria-hidden="true" class="absolute -left-12 -bottom-16 h-56 w-56 rounded-full bg-(--color-champagne)/40 blur-3xl" />
      </div>

      <!-- :initial=false: SSR renders the form visible (no opacity:0 until
           hydration); success ↔ form swaps still animate. -->
      <AnimatePresence mode="wait" :initial="false">
        <motion.div
          v-if="success"
          key="success"
          :initial="{ opacity: 0, scale: 0.9 }"
          :animate="{ opacity: 1, scale: 1 }"
          :exit="{ opacity: 0 }"
          :transition="{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }"
          class="relative text-center"
        >
          <motion.div
            :initial="{ scale: 0 }"
            :animate="{ scale: 1 }"
            :transition="{ delay: 0.2, type: 'spring', stiffness: 220 }"
            class="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-(--color-primary) text-white animate-pulse-ring"
          >
            <Heart class="h-7 w-7" />
          </motion.div>
          <h3 class="text-3xl">{{ t('lead.successTitle') }}</h3>
          <p class="mt-3 text-(--color-muted-foreground)">{{ t('lead.successDesc') }}</p>
        </motion.div>

        <motion.form
          v-else
          key="form"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          class="relative flex flex-col gap-5"
          novalidate
          @submit.prevent="onSubmit"
        >
          <div class="text-center">
            <h3 class="heading-display-md">{{ t('lead.title') }}</h3>
            <p class="mt-2 text-sm text-(--color-muted-foreground)">{{ t('lead.subtitle') }}</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="name" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
              {{ t('lead.name') }}
            </label>
            <input
              id="name"
              v-model="name"
              required
              :maxlength="LEAD_LIMITS.nameMax"
              :aria-invalid="fieldErrors.name ? 'true' : undefined"
              :aria-describedby="fieldErrors.name ? 'name-error' : undefined"
              class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 text-base sm:text-sm placeholder:text-(--color-muted-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
            >
            <p v-if="fieldErrors.name" id="name-error" class="text-xs text-red-700">{{ fieldErrors.name }}</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="phone" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
              {{ t('lead.phone') }}
            </label>
            <MarketingPhoneInput
              id="phone"
              v-model="phone"
              v-model:digits="phoneDigits"
              :aria-invalid="fieldErrors.phone ? 'true' : undefined"
              :aria-describedby="fieldErrors.phone ? 'phone-error' : undefined"
            />
            <p v-if="fieldErrors.phone" id="phone-error" class="text-xs text-red-700">{{ fieldErrors.phone }}</p>
          </div>

          <!-- Grid cells equalize their heights automatically; using
               `flex flex-col` + `mt-auto` on the input wrapper pins both
               inputs to the bottom of the taller cell so they stay
               aligned even when one label wraps onto two lines
               (common on Uzbek "Taxminiy mehmonlar soni"). -->
          <div class="grid grid-cols-2 items-stretch gap-3">
            <div class="flex flex-col">
              <label for="wedding_date" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
                {{ t('lead.weddingDate') }}
              </label>
              <div class="mt-auto pt-1.5">
                <MarketingDatePicker id="wedding_date" v-model="weddingDate" />
              </div>
            </div>
            <div class="flex flex-col">
              <label for="guests" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
                {{ t('lead.guests') }}
              </label>
              <div class="mt-auto pt-1.5">
                <MarketingGuestStepper id="guests" v-model="guests" :min="guestsRange.min" :max="guestsRange.max" />
              </div>
            </div>
          </div>
          <!-- Messages for the two-column row go under it, full width, so
               a message in one cell doesn't knock the inputs out of line. -->
          <p v-if="fieldErrors.wedding_date" class="-mt-3.5 text-xs text-red-700">{{ fieldErrors.wedding_date }}</p>
          <p v-if="fieldErrors.guests" class="-mt-3.5 text-xs text-red-700">{{ fieldErrors.guests }}</p>

          <!-- Honeypot. Off-screen and out of the tab order, so people
               never fill it; form-filling bots do, and the server then
               drops the lead quietly. -->
          <div aria-hidden="true" class="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
            <input v-model="hp" name="hp_note" type="text" tabindex="-1" autocomplete="off">
          </div>

          <div class="flex flex-col gap-1.5">
            <LegalConsentCheckbox
              id="lead-consent"
              v-model="consent"
              keypath="lead.consent"
              :link-text="t('lead.consentLink')"
              :to="localePath('/privacy')"
              :invalid="!!fieldErrors.consent"
              :describedby="fieldErrors.consent ? 'consent-error' : undefined"
            />
            <p v-if="fieldErrors.consent" id="consent-error" class="text-xs text-red-700">{{ fieldErrors.consent }}</p>
          </div>

          <p v-if="error" role="alert" class="text-sm text-red-700">{{ error }}</p>

          <p v-if="chosenTier" class="text-center text-xs uppercase tracking-wider text-(--color-muted-foreground)">
            {{ t('lead.chosenTier', { tier: t(`pricing.${chosenTier}.name`) }) }}
          </p>
          <button
            type="submit"
            :disabled="pending"
            class="inline-flex h-12 items-center justify-center rounded-md bg-(--color-primary) px-7 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-90 disabled:opacity-60"
          >
            {{ pending ? t('lead.submitting') : t('lead.submit') }}
          </button>
          <p class="text-center text-[11px] text-(--color-muted-foreground)">{{ t('lead.contactNote') }}</p>
        </motion.form>
      </AnimatePresence>
    </div>
  </MarketingReveal>
</template>
