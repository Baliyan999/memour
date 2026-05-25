<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useLocalePath } from '#imports'
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
 *     returns { access_token, refresh_token } as JSON. We call
 *     supabase.auth.setSession() which writes them straight into
 *     httpOnly cookies — no magic-link, no token in the URL fragment.
 *
 * Sending the password again at step 2 is intentional: it makes 2FA
 * real. A leaked TG code on its own cannot mint a session, and a
 * leaked password on its own cannot either.
 */
const localePath = useLocalePath()
const supabase = useSupabaseClient()
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

// Skip the form entirely if already a logged-in admin.
watch(
  user,
  async (u) => {
    if (!u) return
    const uid = (u as any).id ?? (u as any).sub
    const { data } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle()
    if (data) navigateTo(localePath('/admin'))
  },
  { immediate: true },
)

// Legacy magic-link landing handler — kept temporarily so anyone
// holding an old emailed magic link can still complete login. New
// logins go through setSession directly without touching the URL.
onMounted(async () => {
  if (typeof window === 'undefined') return
  const hash = window.location.hash
  if (!hash || !hash.includes('access_token=')) return
  const params = new URLSearchParams(hash.slice(1))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  if (!access_token || !refresh_token) return
  try {
    await supabase.auth.setSession({ access_token, refresh_token })
    window.history.replaceState({}, '', window.location.pathname + window.location.search)
  } catch (e) {
    console.error('[admin/login] setSession from hash', e)
  }
})

function mapError(code?: string): string {
  switch (code) {
    case 'bad_credentials': return 'Неверный email или пароль'
    case 'not_admin': return 'Этот аккаунт не имеет прав администратора'
    case 'no_chat_id': return 'У вашего аккаунта не привязан Telegram. Попросите главного админа добавить chat_id.'
    case 'too_many_requests': return 'Слишком часто. Подождите 30 секунд.'
    case 'telegram_failed': return 'Не удалось отправить код в Telegram. Попробуйте позже.'
    case 'invalid_code': return 'Неверный код'
    case 'code_expired': return 'Срок действия кода истёк. Запросите новый.'
    case 'too_many_attempts': return 'Слишком много попыток. Запросите новый код.'
    case 'link_failed': return 'Не удалось завершить вход. Попробуйте снова.'
    case 'session_failed': return 'Не удалось завершить вход. Возможно, пароль был изменён — попробуйте начать заново.'
    default: return 'Ошибка входа'
  }
}

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
  if (!email.value || !password.value) return
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
    error.value = mapError(e?.data?.data?.code ?? e?.data?.code)
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
    const res = await $fetch<{
      ok: boolean
      access_token: string
      refresh_token: string
    }>('/api/admin-auth/verify', {
      method: 'POST',
      body: {
        email: email.value,
        password: password.value,
        code: code.value,
      },
    })
    const { error: sessErr } = await supabase.auth.setSession({
      access_token: res.access_token,
      refresh_token: res.refresh_token,
    })
    if (sessErr) throw sessErr
    // Hard nav: forces the next request to read the freshly-set
    // session cookies from scratch, bypassing any client-side router
    // race where the global auth middleware checks user.value before
    // the SDK's auth state listener has fired.
    if (typeof window !== 'undefined') {
      window.location.href = localePath('/admin')
    }
  } catch (e: any) {
    console.error('[admin/login] verify failed', e)
    error.value = mapError(e?.data?.data?.code ?? e?.data?.code)
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
  <div class="relative min-h-[80vh]">
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
              <span class="text-gradient-gold">{{ step === 'creds' ? 'Вход' : 'Код' }}</span>
            </h1>
            <div class="mt-3 flex items-center gap-3 text-(--color-muted-foreground)">
              <span class="h-px w-12 bg-(--color-border)" />
              <span style="font-size: 10px;">⋄</span>
              <span class="h-px w-12 bg-(--color-border)" />
            </div>
            <p class="mt-3 max-w-xs text-center text-sm text-(--color-muted-foreground)">
              <template v-if="step === 'creds'">Введите email и пароль администратора</template>
              <template v-else>
                Код отправлен в Telegram-бот на ваш аккаунт <span class="block text-(--color-foreground) text-xs mt-1">{{ email }}</span>
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
              @submit.prevent="submitCreds"
            >
              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Email</label>
                <div class="relative">
                  <Mail class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)" :stroke-width="1.6" />
                  <input
                    v-model="email"
                    type="email"
                    required
                    autocomplete="email"
                    class="flex h-12 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  >
                </div>
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Пароль</label>
                <div class="relative">
                  <Lock class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)" :stroke-width="1.6" />
                  <input
                    v-model="password"
                    :type="showPassword ? 'text' : 'password'"
                    required
                    autocomplete="current-password"
                    minlength="6"
                    class="flex h-12 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-11 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  >
                  <button
                    type="button"
                    class="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-(--color-muted-foreground) hover:text-(--color-foreground)"
                    @click="showPassword = !showPassword"
                  >
                    <EyeOff v-if="showPassword" class="h-4 w-4" :stroke-width="1.6" />
                    <Eye v-else class="h-4 w-4" :stroke-width="1.6" />
                  </button>
                </div>
              </div>

              <p v-if="error" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

              <button
                type="submit"
                :disabled="pending || !email || !password"
                class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-95 disabled:opacity-50"
              >
                <span>{{ pending ? 'Проверяем…' : 'Войти' }}</span>
                <ArrowRight v-if="!pending" class="h-4 w-4" />
              </button>

              <p class="mt-1 flex items-center justify-center gap-1.5 text-center text-[11px] text-(--color-muted-foreground)">
                <MessageSquare class="h-3 w-3" :stroke-width="1.6" />
                Код подтверждения придёт в Telegram
              </p>
            </form>

            <!-- Step 2 — code -->
            <form
              v-else
              key="code"
              class="flex flex-col gap-4"
              @submit.prevent="submitCode"
            >
              <div class="flex flex-col gap-2">
                <label class="text-center text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Код из Telegram</label>
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

              <p v-if="error" class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>

              <button
                type="submit"
                :disabled="pending || code.length !== 6"
                class="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-95 disabled:opacity-50"
              >
                <Shield v-if="!pending" class="h-4 w-4" :stroke-width="1.8" />
                <span>{{ pending ? 'Проверяем…' : 'Подтвердить' }}</span>
              </button>

              <div class="flex items-center justify-between text-xs">
                <button
                  type="button"
                  class="text-(--color-muted-foreground) underline decoration-(--color-muted-foreground)/40 underline-offset-2 hover:text-(--color-foreground)"
                  @click="backToCreds"
                >Назад</button>
                <button
                  type="button"
                  :disabled="resendIn > 0 || pending"
                  class="text-(--color-primary) underline decoration-(--color-primary)/40 underline-offset-2 hover:decoration-(--color-primary) disabled:cursor-not-allowed disabled:opacity-50"
                  @click="resend"
                >{{ resendIn > 0 ? `Запросить ещё раз (${resendIn}с)` : 'Запросить ещё раз' }}</button>
              </div>
            </form>
          </Transition>
        </div>
      </motion.div>
    </div>
  </div>
</template>
