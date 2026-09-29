<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { ArrowRight, Phone, Shield, Mail } from '@lucide/vue'

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
 *
 * Before a code or link goes out the couple ticks two boxes — the terms
 * and the privacy policy. Both requests carry them as `consent`; the
 * server refuses without and records them (server/utils/consent.ts).
 * The email link is sent by /api/auth/email/send for the same reason.
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()
const { consentFor, live: legalLive } = useLegal()

// motion-v writes `initial` inline, so a server-rendered card sat at
// opacity 0 until hydration (seconds on slow 4G, forever with JS off).
// Opened directly, the card paints at rest; the entrance plays only
// when the couple arrives here by a link inside the app.
const entrance = !(import.meta.server || useNuxtApp().isHydrating)

// If already logged in, skip straight to dashboard.
watch(
  user,
  (u) => {
    if (u) navigateTo(localePath('/dashboard'))
  },
  { immediate: true },
)

// Magic-link fragment recovery. When the auth middleware bounces a
// magic-link callback (e.g. /dashboard#access_token=…) to this login
// page, the access token rides along in the URL hash. We hand it to
// the Supabase client manually so it sets the session cookie + the
// reactive user, then the watcher above redirects to /dashboard.
// (The email link's ?code= never gets here: server/middleware/auth-code.ts
// turns it into a session first.)
//
// A link that didn't log in arrives as #error=…&error_code=… — from
// Supabase (otp_expired: expired or already used) or from auth-code.ts
// (no verifier: opened in another browser than the one that asked).
// Say so on the email tab, where a new link is one tap away.
const LINK_ERRORS: Record<string, string> = {
  otp_expired: 'link_expired',
  flow_state_expired: 'link_expired',
  pkce_code_verifier_not_found: 'link_other_browser',
  bad_code_verifier: 'link_other_browser',
}
const supabaseAuthClient = useSupabaseClient()
onMounted(async () => {
  if (typeof window === 'undefined') return
  const hash = window.location.hash
  if (!hash) return
  const params = new URLSearchParams(hash.slice(1))
  const cleanHash = () => window.history.replaceState({}, '', window.location.pathname + window.location.search)
  if (params.get('error') || params.get('error_code')) {
    channel.value = 'email'
    error.value = errorMessage(LINK_ERRORS[params.get('error_code') ?? ''] ?? 'link_invalid')
    cleanHash()
    return
  }
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return
  try {
    const { error: err } = await supabaseAuthClient.auth.setSession({ access_token, refresh_token })
    if (err) throw err
  } catch (e) {
    console.error('[login] setSession from hash failed', e)
    channel.value = 'email'
    error.value = errorMessage('link_invalid')
  } finally {
    // Clean the hash so a refresh doesn't reapply the (now used) token.
    cleanHash()
  }
})

// Login channel — phone (primary) or email (fallback when SMS doesn't
// arrive, or for couples who prefer email).
type Channel = 'phone' | 'email'
const channel = ref<Channel>('phone')
function selectChannel(c: Channel) {
  channel.value = c
  error.value = null // the other form's message doesn't belong here
}

type Step = 'phone' | 'code'
const step = ref<Step>('phone')

// Terms + privacy policy — one pair of boxes for both channels.
const acceptTerms = ref(false)
const acceptPrivacy = ref(false)
const consentOk = computed(() => acceptTerms.value && acceptPrivacy.value)
// A send without both boxes marks the unticked ones; ticking them clears that.
const consentMissing = ref(false)
watch(consentOk, (ok) => {
  if (!ok || !consentMissing.value) return
  consentMissing.value = false
  error.value = null
})

// Email-channel state
const emailAddr = ref('')
const emailSent = ref(false)
// ASCII only: GoTrue refuses Cyrillic addresses anyway, and the browser's
// own check would answer in the browser's language.
const emailValid = computed(() => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(emailAddr.value.trim()))

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

function startResendCooldown(seconds: number) {
  resendIn.value = seconds
  clearInterval(resendTimer)
  resendTimer = window.setInterval(() => {
    resendIn.value = Math.max(0, resendIn.value - 1)
    if (resendIn.value === 0) clearInterval(resendTimer)
  }, 1000) as unknown as number
}

/**
 * Error → localized message: couple-specific wording first
 * (`couple.errors.<code>`), then the shared `errors.<code>`, then a
 * generic line. The user never sees raw English "Server Error", stack
 * traces or Supabase texts.
 */
const errorMessage = useErrorMessage('couple')


async function sendCode() {
  if (pending.value) return
  if (!phoneValid.value) {
    error.value = errorMessage('phone_incomplete')
    return
  }
  if (!consentOk.value) {
    consentMissing.value = true
    error.value = errorMessage('consent_required')
    return
  }
  error.value = null
  pending.value = true
  try {
    await $fetch<{ ok: boolean }>('/api/auth/phone/send', {
      method: 'POST',
      body: { phone: `+998${phoneDigits.value}`, consent: consentFor('login') },
    })
    step.value = 'code'
    startResendCooldown(30)
    await nextTick()
    codeRefs.value?.focus()
  } catch (e: any) {
    error.value = errorMessage(e)
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
        body: {
          phone: `+998${phoneDigits.value}`,
          code: code.value,
          locale: locale.value,
          consent: consentFor('login'),
        },
      },
    )
    if (typeof window !== 'undefined') {
      window.location.href = res.action_link
    }
  } catch (e: any) {
    error.value = errorMessage(e)
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

async function sendEmailLink() {
  if (pending.value) return
  if (!emailValid.value) {
    error.value = errorMessage('invalid_email')
    return
  }
  if (!consentOk.value) {
    consentMissing.value = true
    error.value = errorMessage('consent_required')
    return
  }
  error.value = null
  pending.value = true
  try {
    await $fetch<{ ok: boolean }>('/api/auth/email/send', {
      method: 'POST',
      body: { email: emailAddr.value.trim(), locale: locale.value, consent: consentFor('login') },
    })
    emailSent.value = true
  } catch (e: any) {
    error.value = errorMessage(e)
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="relative mx-auto max-w-md pt-2 sm:pt-6">
    <motion.div
      :initial="entrance ? { opacity: 0, y: 20, scale: 0.96 } : false"
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

        <!-- Channel switcher (phone / email) — only on the entry step -->
        <div
          v-if="step === 'phone' && !emailSent"
          class="mb-4 flex items-center gap-1 rounded-full border border-(--color-border) bg-white p-0.5"
        >
          <button
            type="button"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors',
              channel === 'phone'
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="selectChannel('phone')"
          >
            <Phone class="h-3.5 w-3.5" :stroke-width="1.8" />
            {{ t('couple.channelPhone') }}
          </button>
          <button
            type="button"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors',
              channel === 'email'
                ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
            ]"
            @click="selectChannel('email')"
          >
            <Mail class="h-3.5 w-3.5" :stroke-width="1.8" />
            {{ t('couple.channelEmail') }}
          </button>
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
          <!-- Email channel — sent state -->
          <div v-if="channel === 'email' && emailSent" key="email-sent" class="text-center">
            <div class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-(--color-primary) text-white">
              <Mail class="h-7 w-7" :stroke-width="1.6" />
            </div>
            <p class="text-base">{{ t('couple.emailCheckInbox') }}</p>
            <p class="mt-1 break-all text-sm text-(--color-muted-foreground)">{{ emailAddr }}</p>
            <p class="mt-3 text-[11px] text-(--color-muted-foreground)">
              {{ t('couple.emailValidNote') }}
            </p>
          </div>

          <!-- Email channel — form -->
          <form
            v-else-if="channel === 'email'"
            key="email-form"
            class="flex flex-col gap-4"
            novalidate
            @submit.prevent="sendEmailLink"
          >
            <div class="flex flex-col gap-1.5">
              <label for="login-email" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('couple.emailLabel') }}</label>
              <div class="relative">
                <Mail class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)" :stroke-width="1.6" />
                <input
                  id="login-email"
                  v-model="emailAddr"
                  type="email"
                  autocomplete="email"
                  required
                  :aria-invalid="error && !emailValid ? 'true' : undefined"
                  placeholder="you@example.com"
                  class="flex h-11 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                >
              </div>
            </div>

            <div class="flex flex-col gap-2.5">
              <LegalConsentCheckbox
                id="login-terms-email"
                v-model="acceptTerms"
                keypath="couple.consentTerms"
                :link-text="t(legalLive ? 'couple.consentTermsLink' : 'couple.consentTermsLinkInterim')"
                :to="localePath('/terms')"
                :invalid="consentMissing && !acceptTerms"
              />
              <LegalConsentCheckbox
                id="login-privacy-email"
                v-model="acceptPrivacy"
                keypath="couple.consentPrivacy"
                :link-text="t('couple.consentPrivacyLink')"
                :to="localePath('/privacy')"
                :invalid="consentMissing && !acceptPrivacy"
              />
            </div>

            <p v-if="error" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

            <button
              type="submit"
              :disabled="pending"
              class="inline-flex h-12 items-center justify-center rounded-md bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-50"
            >
              {{ pending ? t('couple.sending') : t('couple.sendMagicLink') }}
            </button>

            <p class="text-center text-[11px] text-(--color-muted-foreground)">
              {{ t('couple.emailNote') }}
            </p>
          </form>

          <!-- Phone step -->
          <form
            v-else-if="step === 'phone'"
            key="phone"
            class="flex flex-col gap-4"
            novalidate
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

            <div class="flex flex-col gap-2.5">
              <LegalConsentCheckbox
                id="login-terms-phone"
                v-model="acceptTerms"
                keypath="couple.consentTerms"
                :link-text="t(legalLive ? 'couple.consentTermsLink' : 'couple.consentTermsLinkInterim')"
                :to="localePath('/terms')"
                :invalid="consentMissing && !acceptTerms"
              />
              <LegalConsentCheckbox
                id="login-privacy-phone"
                v-model="acceptPrivacy"
                keypath="couple.consentPrivacy"
                :link-text="t('couple.consentPrivacyLink')"
                :to="localePath('/privacy')"
                :invalid="consentMissing && !acceptPrivacy"
              />
            </div>

            <p
              v-if="error"
              role="alert"
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >{{ error }}</p>

            <button
              type="submit"
              :disabled="pending"
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
            novalidate
            @submit.prevent="verifyCode"
          >
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
              role="alert"
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
