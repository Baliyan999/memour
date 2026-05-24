<script setup lang="ts">
import { ref, watch, computed, onMounted } from 'vue'
import { useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { ArrowRight, Mail, Lock, Eye, EyeOff } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/login — password-based admin entry.
 *
 *   Step 1: email + password → supabase.auth.signInWithPassword
 *   Step 2 (after sign-in): verify the user is in the admins table.
 *     If yes → /admin. If no → sign out, show "no admin rights".
 *
 * No magic link, no synthetic redirects — flow stays on this page
 * until success. A future 2FA layer would slot in between steps 1
 * and 2 once we wire an email provider.
 */
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const pending = ref(false)
const error = ref<string | null>(null)

// If already an admin and arrives here, jump straight to /admin.
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

async function submit() {
  if (!email.value || !password.value) return
  pending.value = true
  error.value = null
  try {
    const { data, error: signErr } = await supabase.auth.signInWithPassword({
      email: email.value.trim(),
      password: password.value,
    })
    if (signErr || !data.session) {
      // Supabase returns generic 400 for both wrong-password and
      // unknown-email. Show one neutral message — don't leak whether
      // the email exists.
      error.value = 'Неверный email или пароль'
      return
    }
    // Verify admin row exists.
    const uid = (data.user as any).id
    const { data: adminRow } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle()
    if (!adminRow) {
      // Sign back out so the synthetic non-admin session doesn't
      // linger and let them see the admin layout chrome.
      await supabase.auth.signOut()
      error.value = 'Этот аккаунт не имеет прав администратора'
      return
    }
    // All good — the watcher above will navigate to /admin once user
    // becomes set.
    router.push(localePath('/admin'))
  } catch (e: any) {
    error.value = e?.message ?? 'Ошибка входа'
  } finally {
    pending.value = false
  }
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
              <img
                src="/memour-logo.png"
                alt="Memour"
                width="56"
                height="56"
                class="h-12 w-12 sm:h-14 sm:w-14"
              >
              <span
                class="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-(--color-foreground) text-white"
              >
                <Lock class="h-3 w-3" :stroke-width="2.2" />
              </span>
            </div>
            <p class="mt-4 text-[10px] uppercase tracking-[0.4em] text-(--color-muted-foreground)">
              Memour · admin
            </p>
            <h1
              class="mt-2 font-display italic"
              style="font-size: 2.5rem; line-height: 1; letter-spacing: -0.02em;"
            >
              <span class="text-gradient-gold">Вход</span>
            </h1>
            <div class="mt-3 flex items-center gap-3 text-(--color-muted-foreground)">
              <span class="h-px w-12 bg-(--color-border)" />
              <span style="font-size: 10px;">⋄</span>
              <span class="h-px w-12 bg-(--color-border)" />
            </div>
          </div>

          <form class="flex flex-col gap-4" @submit.prevent="submit">
            <div class="flex flex-col gap-1.5">
              <label
                for="admin-email"
                class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)"
              >Email</label>
              <div class="relative">
                <Mail
                  class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)"
                  :stroke-width="1.6"
                />
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
              <label
                for="admin-password"
                class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)"
              >Пароль</label>
              <div class="relative">
                <Lock
                  class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--color-muted-foreground)"
                  :stroke-width="1.6"
                />
                <input
                  id="admin-password"
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
                  :aria-label="showPassword ? 'Скрыть пароль' : 'Показать пароль'"
                  @click="showPassword = !showPassword"
                >
                  <EyeOff v-if="showPassword" class="h-4 w-4" :stroke-width="1.6" />
                  <Eye v-else class="h-4 w-4" :stroke-width="1.6" />
                </button>
              </div>
            </div>

            <p
              v-if="error"
              class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >{{ error }}</p>

            <button
              type="submit"
              :disabled="pending || !email || !password"
              class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-95 disabled:opacity-50"
            >
              <span class="relative z-10 flex items-center gap-2">
                {{ pending ? 'Входим…' : 'Войти' }}
                <ArrowRight
                  v-if="!pending"
                  class="h-4 w-4 transition-transform group-hover:translate-x-1"
                />
              </span>
            </button>

            <p class="mt-1 text-center text-[11px] text-(--color-muted-foreground)">
              Доступ только для зарегистрированных администраторов
            </p>
          </form>
        </div>
      </motion.div>
    </div>
  </div>
</template>
