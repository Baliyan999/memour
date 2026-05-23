<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { ArrowRight, Mail, Lock } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

/**
 * Admin login — magic-link entry to the back office. Visual language:
 *   • Memour logo + decorative gold rings ornament behind the card
 *   • Sparkle decorations drifting in the card corners
 *   • Italic display title with gold gradient
 *   • Email input with subtle Mail icon affordance
 *   • Primary button with shimmer hover (matches landing CTAs)
 *
 * After Supabase auth succeeds the watcher confirms the user is in
 * the `admins` table; if not, an inline error explains why.
 */
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()

const email = ref('')
const pending = ref(false)
const sent = ref(false)
const error = ref<string | null>(null)

watch(
  user,
  async (u) => {
    if (!u) return
    const { data } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', u.id)
      .maybeSingle()
    if (data) navigateTo(localePath('/admin'))
    else error.value = 'Этот аккаунт не имеет прав администратора.'
  },
  { immediate: true },
)

async function submit() {
  error.value = null
  pending.value = true
  try {
    const redirectTo =
      typeof window !== 'undefined'
        ? `${window.location.origin}${localePath('/admin')}`
        : undefined
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.value,
      options: { emailRedirectTo: redirectTo },
    })
    if (err) throw err
    sent.value = true
  } catch (e: any) {
    error.value = e?.message ?? 'Login error'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="relative min-h-[80vh]">
    <!-- Decorative gold rings ornament floating behind the card -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 opacity-50"
    >
      <MarketingOrnaments kind="rings" :size="520" />
    </div>

    <div class="relative mx-auto max-w-md pt-8 sm:pt-16">
      <motion.div
        :initial="{ opacity: 0, y: 20, scale: 0.96 }"
        :animate="{ opacity: 1, y: 0, scale: 1 }"
        :transition="{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }"
      >
        <div
          class="surface-card relative overflow-hidden rounded-(--radius-xl) p-8 sm:p-10"
        >
          <!-- Sparkles in corners -->
          <MarketingOrnaments kind="sparkle" :size="14" x="6%" y="8%" :delay="0" />
          <MarketingOrnaments kind="sparkle" :size="10" x="92%" y="14%" :delay="1.2" />
          <MarketingOrnaments kind="sparkle" :size="12" x="88%" y="86%" :delay="0.6" />

          <!-- Logo + lock badge -->
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

            <!-- Ornament divider -->
            <div class="mt-3 flex items-center gap-3 text-(--color-muted-foreground)">
              <span class="h-px w-12 bg-(--color-border)" />
              <span style="font-size: 10px;">⋄</span>
              <span class="h-px w-12 bg-(--color-border)" />
            </div>

            <p class="mt-3 max-w-xs text-center text-sm text-(--color-muted-foreground)">
              Введите email — пришлём защищённую ссылку для входа
            </p>
          </div>

          <!-- Sent state -->
          <Transition
            enter-active-class="transition duration-300"
            enter-from-class="opacity-0 translate-y-2"
            enter-to-class="opacity-100 translate-y-0"
            mode="out-in"
          >
            <div v-if="sent" key="sent" class="text-center">
              <div
                class="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full text-white shadow-(--shadow-glow)"
                style="background: linear-gradient(135deg, oklch(60% 0.09 35), oklch(50% 0.08 30));"
              >
                <Mail class="h-7 w-7" :stroke-width="1.6" />
              </div>
              <p class="font-display text-xl">Проверьте почту</p>
              <p class="mt-2 break-all text-sm text-(--color-muted-foreground)">
                {{ email }}
              </p>
              <p class="mt-3 text-[11px] text-(--color-muted-foreground)">
                Письмо приходит за 5–30 секунд. Не забудьте папку «Спам».
              </p>
            </div>

            <form v-else key="form" class="flex flex-col gap-4" @submit.prevent="submit">
              <div class="flex flex-col gap-1.5">
                <label
                  for="admin-email"
                  class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)"
                >
                  Email администратора
                </label>
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
                    placeholder="you@memour.uz"
                    class="flex h-12 w-full rounded-md border border-(--color-border) bg-white pl-10 pr-3 text-sm placeholder:text-(--color-muted-foreground)/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring)"
                  >
                </div>
              </div>

              <p
                v-if="error"
                class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >{{ error }}</p>

              <button
                type="submit"
                :disabled="pending || !email"
                class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-95 disabled:opacity-50"
              >
                <span class="relative z-10 flex items-center gap-2">
                  {{ pending ? 'Отправляем…' : 'Отправить magic-link' }}
                  <ArrowRight
                    v-if="!pending"
                    class="h-4 w-4 transition-transform group-hover:translate-x-1"
                  />
                </span>
                <span
                  class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]"
                />
              </button>

              <p class="mt-1 text-center text-[11px] text-(--color-muted-foreground)">
                Доступ только для зарегистрированных администраторов
              </p>
            </form>
          </Transition>
        </div>
      </motion.div>

      <!-- Bottom helper link -->
      <p class="mt-6 text-center text-xs text-(--color-muted-foreground)">
        Не админ? <NuxtLink
          :to="localePath('/dashboard/login')"
          class="text-(--color-primary) underline decoration-(--color-primary)/30 underline-offset-2 hover:decoration-(--color-primary)"
        >Вход для пары</NuxtLink>
      </p>
    </div>
  </div>
</template>
