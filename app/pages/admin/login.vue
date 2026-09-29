<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { ArrowRight, Mail, Lock, Eye, EyeOff, MessageSquare, Shield } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/login — two-step admin entry:
 *
 *   Step 1: email + password → POST /api/admin-auth/login
 *     The server verifies the password against Supabase Auth, looks
 *     up the admin's telegram_chat_id, and sends a 6-digit code to
 *     that Telegram chat via the Memour bot. Nothing is logged in yet.
 *
 *   Step 2: email + password + code → POST /api/admin-auth/verify
 *     The server validates the code AND re-checks the password, then
 *     writes the Supabase session cookies plus the signed 2FA cookie
 *     into its response — no magic-link, no token in the URL fragment.
 *     The admin API and the /admin pages require that 2FA cookie, so a
 *     Supabase session obtained any other way doesn't open the admin.
 *
 * Sending the password again at step 2 is intentional: it makes 2FA
 * real. A leaked TG code on its own cannot mint a session, and a
 * leaked password on its own cannot either.
 */
const { t } = useI18n()
const localePath = useLocalePath()
const user = useSupabaseUser()

const step = ref<'creds' | 'code'>('creds')
const email = ref('')
const password = ref('')
const digits = ref<string[]>(['', '', '', '', '', ''])
const code = computed(() => digits.value.join(''))
const digitInputs: HTMLInputElement[] = []
const showPassword = ref(false)
const pending = ref(false)
const error = ref<string | null>(null)
const resendIn = ref(0)
let resendTimer: number | undefined

function setDigitRef(el: any, i: number) {
  if (el) digitInputs[i] = el as HTMLInputElement
}

function focusDigit(i: number) {
  nextTick(() => digitInputs[i]?.focus())
}

function resetDigits() {
  digits.value = ['', '', '', '', '', '']
}

// Skip the form if this browser already has full admin access
// (session + Telegram 2FA). Only the server knows — the 2FA proof is an
// httpOnly cookie — and a session without it must stay on this page,
// otherwise the route middleware would bounce it straight back here.
watch(
  user,
  async (u) => {
    if (!u || import.meta.server) return
    try {
      await $fetch('/api/admin-auth/status')
      navigateTo(localePath('/admin'))
    } catch {
      // No 2FA yet — show the form.
    }
  },
  { immediate: true },
)

/**
 * Server errors carry a stable `data.code`; show its translation —
 * login-specific wording first (`admin.login.errors.<code>`), then the
 * shared `errors.<code>`, then a generic line — never the server's own
 * text.
 */
const errorMessage = useErrorMessage('admin.login')
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

function startResendCooldown(seconds: number) {
  resendIn.value = seconds
  clearInterval(resendTimer)
  resendTimer = window.setInterval(() => {
    resendIn.value = Math.max(0, resendIn.value - 1)
    if (resendIn.value === 0) clearInterval(resendTimer)
  }, 1000) as unknown as number
}

async function submitCreds() {
  if (pending.value) return
  // Our own checks (the form is novalidate): the browser's bubbles
  // speak the browser's language. Password length is the server's
  // business — a wrong one is just bad_credentials.
  if (!EMAIL_RE.test(email.value.trim())) {
    error.value = errorMessage('invalid_email')
    return
  }
  if (!password.value) {
    error.value = t('validation.passwordRequired')
    return
  }
  pending.value = true
  error.value = null
  try {
    await $fetch('/api/admin-auth/login', {
      method: 'POST',
      body: { email: email.value, password: password.value },
    })
    step.value = 'code'
    startResendCooldown(30)
    resetDigits()
    focusDigit(0)
  } catch (e: any) {
    error.value = errorMessage(e)
  } finally {
    pending.value = false
  }
}

async function submitCode() {
  if (pending.value) return
  if (code.value.length !== 6) return
  pending.value = true
  error.value = null
  try {
    await $fetch('/api/admin-auth/verify', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        code: code.value,
      },
    })
    // Server already wrote the auth cookies to this response. Hard-nav
    // so the next request includes them and SSR sees the session.
    if (typeof window !== 'undefined') {
      window.location.href = localePath('/admin')
    }
  } catch (e: any) {
    error.value = errorMessage(e)
    resetDigits()
    focusDigit(0)
  } finally {
    pending.value = false
  }
}

// Per-box input — single digit, advance focus on entry, jump back on
// Backspace, swallow paste and distribute across remaining boxes.
function onDigitInput(i: number, e: Event) {
  const input = e.target as HTMLInputElement
  const raw = input.value.replace(/\D/g, '')
  if (raw.length > 1) {
    distributeText(raw, i)
    return
  }
  digits.value[i] = raw
  // Reflect cleaned value back to DOM (rejects non-digit input)
  input.value = raw
  if (raw && i < 5) focusDigit(i + 1)
}

function onDigitKeydown(i: number, e: KeyboardEvent) {
  if (e.key === 'Backspace') {
    if (digits.value[i]) {
      digits.value[i] = ''
      e.preventDefault()
    } else if (i > 0) {
      digits.value[i - 1] = ''
      focusDigit(i - 1)
      e.preventDefault()
    }
  } else if (e.key === 'ArrowLeft' && i > 0) {
    focusDigit(i - 1)
    e.preventDefault()
  } else if (e.key === 'ArrowRight' && i < 5) {
    focusDigit(i + 1)
    e.preventDefault()
  }
  // Enter is handled by the surrounding <form @submit.prevent>
}

function onDigitPaste(i: number, e: ClipboardEvent) {
  e.preventDefault()
  const text = e.clipboardData?.getData('text') ?? ''
  distributeText(text, i)
}

function distributeText(text: string, startIdx: number) {
  const cleaned = text.replace(/\D/g, '').slice(0, 6 - startIdx)
  if (!cleaned) return
  for (let j = 0; j < cleaned.length; j++) {
    digits.value[startIdx + j] = cleaned[j]!
  }
  const target = Math.min(startIdx + cleaned.length, 5)
  focusDigit(target)
}

async function resend() {
  if (resendIn.value > 0) return
  await submitCreds()
}

function backToCreds() {
  step.value = 'creds'
  resetDigits()
  error.value = null
}

</script>

<template>
  <div class="relative min-h-[80vh] overflow-x-clip">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 opacity-40"
    >
      <MarketingOrnaments kind="rings" :size="520" />
    </div>

    <div class="relative mx-auto max-w-md pt-8 sm:pt-16">
      <motion.div
        :initial="{ opacity: 0, y: 20, scale: 0.96 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
      >
        <div class="surface-card relative overflow-hidden rounded-(--radius-xl) p-8 sm:p-10">
          <MarketingOrnaments kind="sparkle" :size="14" x="6%" y="8%" :delay="0" />
          <MarketingOrnaments kind="sparkle" :size="10" x="92%" y="14%" :delay="1.2" />

          <div class="mb-7 flex flex-col items-center">
            <div class="relative">
              <img src="/memour-logo.png" alt="Memour" width="56" height="56" class="h-12 w-12 sm:h-14 sm:w-14">
              <span class="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-(--color-foreground) text-white">
                <Lock class="h-3 w-3" :stroke-width="2.2" />
              </span>
            </div>
            <p class="mt-4 text-[10px] uppercase tracking-[0.4em] text-(--color-muted-foreground)">Memour · admin</p>
            <h1 class="mt-2 font-display italic" style="font-size: 2.5rem; line-height: 1; letter-spacing: -0.02em;">
              <span class="text-gradient-gold">{{ step === 'creds' ? t('admin.login.titleCreds') : t('admin.login.titleCode') }}</span>
            </h1>
            <div class="mt-3 flex items-center gap-3 text-(--color-muted-foreground)">
              <span class="h-px w-12 bg-(--color-border)" />
              <span style="font-size: 10px;">⋄</span>
              <span class="h-px w-12 bg-(--color-border)" />
            </div>
            <p class="mt-3 max-w-xs text-center text-sm text-(--color-muted-foreground)">
              <template v-if="step === 'creds'">{{ t('admin.login.descCreds') }}</template>
              <template v-else>
                {{ t('admin.login.descCode') }} <span class="block text-(--color-foreground) text-xs mt-1">{{ email }}</span>
              </template>
            </p>
          </div>

          <Transition
            enter-active-class="transition duration-300"
            enter-from-class="opacity-0 translate-x-3"
            enter-to-class="opacity-100 translate-x-0"
            leave-active-class="transition duration-200"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0 -translate-x-3"
            mode="out-in"
          >
            <!-- Step 1 — credentials -->
            <form
              v-if="step === 'creds'"
              key="creds"
              class="flex flex-col gap-4"
              novalidate
              @submit.prevent="submitCreds"
            >
              <div class="flex flex-col gap-1.5">
                <label for="admin-email" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.login.emailLabel') }}</label>
                <div class="relative">
                  <Mail class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)" :stroke-width="1.6" />
                  <input
                    id="admin-email"
                    v-model="email"
                    type="email"
                    required
                    autocomplete="email"
                    class="flex h-12 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  >
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label for="admin-password" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.login.passwordLabel') }}</label>
                <div class="relative">
                  <Lock class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)" :stroke-width="1.6" />
                  <input
                    id="admin-password"
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    required
                    autocomplete="current-password"
                    class="flex h-12 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-11 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  >
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-(--color-muted-foreground) hover:text-(--color-foreground)"
                    :aria-label="showPassword ? t('admin.login.hidePassword') : t('admin.login.showPassword')"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOff v-if="showPassword" class="h-4 w-4" :stroke-width="1.6" />
                    <Eye v-else class="h-4 w-4" :stroke-width="1.6" />
                  </button>
                </div>
              </div>

              <p v-if="error" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

              <button
                type="submit"
                :disabled="pending || !email || !password"
                class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-95 disabled:opacity-50"
              >
                <span>{{ pending ? t('admin.login.checking') : t('admin.login.submit') }}</span>
                <ArrowRight v-if="!pending" class="h-4 w-4" />
              </button>

              <p class="mt-1 flex items-center justify-center gap-1.5 text-center text-[11px] text-(--color-muted-foreground)">
                <MessageSquare class="h-3 w-3" :stroke-width="1.6" />
                {{ t('admin.login.telegramNote') }}
              </p>
            </form>

            <!-- Step 2 — code -->
            <form
              v-else
              key="code"
              class="flex flex-col gap-4"
              novalidate
              @submit.prevent="submitCode"
            >
              <div class="flex flex-col gap-2">
                <label class="text-center text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.login.codeLabel') }}</label>
                <div class="flex justify-center gap-2 sm:gap-3">
                  <input
                    v-for="(_, i) in 6"
                    :key="i"
                    :ref="(el) => setDigitRef(el, i)"
                    :value="digits[i]"
                    type="text"
                    inputmode="numeric"
                    :autocomplete="i === 0 ? 'one-time-code' : 'off'"
                    maxlength="1"
                    class="h-14 w-11 rounded-md border border-(--color-border) bg-white text-center font-mono text-2xl font-medium tabular-nums sm:h-16 sm:w-12 sm:text-3xl focus-visible:border-(--color-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                    @input="onDigitInput(i, $event)"
                    @keydown="onDigitKeydown(i, $event)"
                    @paste="onDigitPaste(i, $event)"
                    @focus="($event.target as HTMLInputElement).select()"
                  >
                </div>
              </div>

              <p v-if="error" role="alert" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

              <button
                type="submit"
                :disabled="pending || code.length !== 6"
                class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-95 disabled:opacity-50"
              >
                <Shield v-if="!pending" class="h-4 w-4" :stroke-width="1.8" />
                <span>{{ pending ? t('admin.login.checking') : t('admin.login.confirm') }}</span>
              </button>

              <div class="flex items-center justify-between text-xs">
                <button
                  type="button"
                  class="text-(--color-muted-foreground) underline decoration-(--color-muted-foreground)/40 underline-offset-2 hover:text-(--color-foreground)"
                  @click="backToCreds"
                >{{ t('admin.login.back') }}</button>
                <button
                  type="button"
                  :disabled="resendIn > 0 || pending"
                  class="text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2 hover:decoration-(--color-primary) disabled:cursor-not-allowed disabled:opacity-50"
                  @click="resend"
                >{{ resendIn > 0 ? t('admin.login.resendIn', { sec: resendIn }) : t('admin.login.resend') }}</button>
              </div>
            </form>
          </Transition>
        </div>
      </motion.div>
    </div>
  </div>
</template>
