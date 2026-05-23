<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { ArrowRight, Phone, Shield } from '@lucide/vue'

definePageMeta({ layout: 'dashboard' })

/**
 * Couple login — phone-based OTP. Two-step UI:
 *
 *   1. Phone step: user enters +998 phone via the same masked input
 *      used on the lead form. Submit → /api/auth/phone/send.
 *   2. Code step: user types the 6-digit SMS code. Submit →
 *      /api/auth/phone/verify which returns a one-time `action_link`.
 *      We navigate to that link; Supabase consumes it, sets the
 *      session cookies, and bounces us to /dashboard.
 *
 * The whole experience matches the brand: gold gradient title,
 * polaroid-style card, sliding step transition. A resend countdown
 * prevents accidental double-sends.
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()

// If already logged in, skip straight to dashboard.
watch(
  user,
  (u) => {
    if (u) navigateTo(localePath('/dashboard'))
  },
  { immediate: true },
)

type Step = 'phone' | 'code'
const step = ref<Step>('phone')

// Phone-step state — mirrors LeadForm: digits is the raw 9-digit
// user portion, modelValue is the formatted "+998 XX XXX XX XX".
const phone = ref('+998 ')
const phoneDigits = ref('')
const phoneValid = computed(() => phoneDigits.value.length === 9)

// Code-step state — 6-digit OTP entered as one string. The UI splits
// into 6 visual boxes via overlaid spans but the underlying input is
// a single field for paste support and accessibility.
const code = ref('')
const codeRefs = ref<HTMLInputElement | null>(null)
const codeValid = computed(() => code.value.length === 6)

const pending = ref(false)
const error = ref<string | null>(null)
const resendIn = ref(0) // seconds until next resend allowed
let resendTimer: number | undefined

// Test-mode helper: while Eskiz hasn't approved our production
// template the SMS we send only contains a fixed test string ("Bu
// Eskiz dan test"). The actual OTP code comes back in the API
// response so the dev UI can display it. This whole banner goes
// away as soon as the prod template is live.
const devCode = ref<string | null>(null)

function startResendCooldown(seconds: number) {
  resendIn.value = seconds
  clearInterval(resendTimer)
  resendTimer = window.setInterval(() => {
    resendIn.value = Math.max(0, resendIn.value - 1)
    if (resendIn.value === 0) clearInterval(resendTimer)
  }, 1000) as unknown as number
}

/**
 * Map a server error to a localized message. The server always sends
 * `data.code` (a stable string like `invalid_code`); we translate it
 * via i18n. Anything unrecognized falls back to a generic message so
 * the user never sees raw English "Server Error" / stack traces.
 */
function localizedError(e: any): string {
  const code: string | undefined = e?.data?.data?.code ?? e?.data?.code
  const key = code ? `couple.errors.${code}` : null
  if (key) {
    const translated = t(key)
    if (translated !== key) return translated
  }
  return t('couple.errors.unknown')
}

async function sendCode() {
  error.value = null
  pending.value = true
  try {
    const res = await $fetch<{ ok: boolean; dev_code?: string }>(
      '/api/auth/phone/send',
      {
        method: 'POST',
        body: { phone: `+998${phoneDigits.value}` },
      },
    )
    devCode.value = res.dev_code ?? null
    step.value = 'code'
    startResendCooldown(30)
    await nextTick()
    codeRefs.value?.focus()
  } catch (e: any) {
    error.value = localizedError(e)
  } finally {
    pending.value = false
  }
}

async function verifyCode() {
  error.value = null
  pending.value = true
  try {
    const res = await $fetch<{ ok: boolean; action_link: string }>(
      '/api/auth/phone/verify',
      {
        method: 'POST',
        body: { phone: `+998${phoneDigits.value}`, code: code.value },
      },
    )
    if (typeof window !== 'undefined') {
      window.location.href = res.action_link
    }
  } catch (e: any) {
    error.value = localizedError(e)
  } finally {
    pending.value = false
  }
}

function onCodeInput(e: Event) {
  const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6)
  code.value = v
  if (v.length === 6) verifyCode()
}

function backToPhone() {
  step.value = 'phone'
  code.value = ''
  error.value = null
}
</script>

<template>
  <div class="relative mx-auto max-w-md pt-2 sm:pt-6">
    <motion.div
      :initial="{ opacity: 0, y: 20, scale: 0.96 }"
      :animate="{ opacity: 1, y: 0, scale: 1 }"
      :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
    >
      <div class="surface-card relative overflow-hidden rounded-(--radius-xl) p-7 sm:p-10">
        <MarketingOrnaments kind="sparkle" :size="14" x="6%" y="8%" :delay="0" />
        <MarketingOrnaments kind="sparkle" :size="10" x="92%" y="14%" :delay="1.2" />
        <MarketingOrnaments kind="sparkle" :size="12" x="88%" y="86%" :delay="0.6" />

        <!-- Header -->
        <div class="mb-6 flex flex-col items-center text-center">
          <img src="/memour-logo.png" alt="Memour" width="48" height="48" class="h-11 w-11">
          <p class="mt-3 text-[10px] uppercase tracking-[0.4em] text-(--color-muted-foreground)">
            {{ t('couple.eyebrow') }}
          </p>
          <h1
            class="mt-1 font-display italic"
            style="font-size: 2.25rem; line-height: 1; letter-spacing: -0.015em;"
          >
            <span class="text-gradient-gold">
              {{ step === 'phone' ? t('couple.loginPhoneTitle') : t('couple.loginCodeTitle') }}
            </span>
          </h1>
          <div class="mt-3 flex items-center gap-3 text-(--color-muted-foreground)">
            <span class="h-px w-10 bg-(--color-border)" />
            <span style="font-size: 10px;">⋄</span>
            <span class="h-px w-10 bg-(--color-border)" />
          </div>
          <p class="mt-3 max-w-xs text-sm text-(--color-muted-foreground)">
            <template v-if="step === 'phone'">{{ t('couple.loginPhoneDesc') }}</template>
            <template v-else>{{ t('couple.loginCodeDesc') }} <strong class="block whitespace-nowrap font-medium text-(--color-foreground) mt-0.5">+998&nbsp;{{ phoneDigits.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4') }}</strong></template>
          </p>
        </div>

        <!-- Step transition -->
        <Transition
          enter-active-class="transition duration-300"
          enter-from-class="opacity-0 translate-x-3"
          enter-to-class="opacity-100 translate-x-0"
          leave-active-class="transition duration-200"
          leave-from-class="opacity-100 translate-x-0"
          leave-to-class="opacity-0 -translate-x-3"
          mode="out-in"
        >
          <!-- Phone step -->
          <form
            v-if="step === 'phone'"
            key="phone"
            class="flex flex-col gap-4"
            @submit.prevent="sendCode"
          >
            <div class="flex flex-col gap-1.5">
              <label
                for="login-phone"
                class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)"
              >{{ t('lead.phone') }}</label>
              <div class="relative">
                <Phone
                  class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)"
                  :stroke-width="1.6"
                />
                <MarketingPhoneInput
                  id="login-phone"
                  v-model="phone"
                  v-model:digits="phoneDigits"
                  class="pl-10"
                />
              </div>
            </div>

            <p
              v-if="error"
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >{{ error }}</p>

            <button
              type="submit"
              :disabled="!phoneValid || pending"
              class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-95 disabled:opacity-50"
            >
              <span class="relative z-10 flex items-center gap-2">
                {{ pending ? t('couple.sending') : t('couple.sendCodeButton') }}
                <ArrowRight v-if="!pending" class="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
              <span class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]" />
            </button>

            <p class="text-center text-[11px] text-(--color-muted-foreground)">
              {{ t('couple.smsNote') }}
            </p>
          </form>

          <!-- Code step -->
          <form
            v-else
            key="code"
            class="flex flex-col gap-4"
            @submit.prevent="verifyCode"
          >
            <!-- DEV banner: visible only while Eskiz is in test mode
                 and the API returns the actual code in the response.
                 Goes away once production template is approved and
                 ESKIZ_USE_TEST_TEMPLATE flips to false. -->
            <div
              v-if="devCode"
              class="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5"
            >
              <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-300/40 text-amber-700">
                <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 9v4M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-[10px] font-medium uppercase tracking-wider text-amber-800">DEV-режим</p>
                <p class="mt-0.5 text-sm text-amber-900">
                  Eskiz пока шлёт тестовый текст без кода. Ваш код:
                  <span class="ml-1 font-mono text-base font-semibold tracking-widest">{{ devCode }}</span>
                </p>
              </div>
            </div>

            <div class="flex flex-col gap-1.5">
              <label
                for="login-code"
                class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)"
              >{{ t('couple.codeLabel') }}</label>
              <!-- One real input for accessibility + paste; 6 visual boxes overlaid -->
              <div class="relative">
                <input
                  id="login-code"
                  ref="codeRefs"
                  :value="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="\d{6}"
                  maxlength="6"
                  class="peer absolute inset-0 h-14 w-full rounded-md border border-(--color-border) bg-white text-center font-mono text-2xl tracking-[0.5em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  @input="onCodeInput"
                >
              </div>
              <div class="h-14" />
            </div>

            <p
              v-if="error"
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >{{ error }}</p>

            <button
              type="submit"
              :disabled="!codeValid || pending"
              class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-95 disabled:opacity-50"
            >
              <span class="relative z-10 flex items-center gap-2">
                <Shield v-if="!pending" class="h-4 w-4" :stroke-width="1.8" />
                {{ pending ? t('couple.verifying') : t('couple.verifyButton') }}
              </span>
              <span class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]" />
            </button>

            <div class="flex items-center justify-between text-xs">
              <button
                type="button"
                class="text-(--color-muted-foreground) underline decoration-(--color-muted-foreground)/40 underline-offset-2 hover:text-(--color-foreground)"
                @click="backToPhone"
              >{{ t('couple.changePhone') }}</button>
              <button
                type="button"
                :disabled="resendIn > 0 || pending"
                class="text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2 hover:decoration-(--color-primary) disabled:cursor-not-allowed disabled:opacity-50"
                @click="sendCode"
              >{{ resendIn > 0 ? t('couple.resendIn', { sec: resendIn }) : t('couple.resend') }}</button>
            </div>
          </form>
        </Transition>
      </div>
    </motion.div>

    <p class="mt-6 text-center text-xs text-(--color-muted-foreground)">
      {{ t('couple.noEventsDesc') }}
    </p>
  </div>
</template>
