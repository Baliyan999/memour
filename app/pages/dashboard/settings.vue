<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useSwitchLocalePath, useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { Globe, MessageSquare, LogOut, ChevronRight } from '@lucide/vue'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/settings — couple's account preferences.
 *
 * Sections:
 *   • Language (links to the locale-switched copy of this same page)
 *   • Telegram bot — deep link to start a chat with @QRFotografBot
 *     (kept as one-tap CTA; full bind flow comes later when the bot
 *     receives /start <token>)
 *   • Sign out
 */
const { t, locale, locales } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const phone = computed(() => user.value?.user_metadata?.phone ?? null)
const email = computed(() => user.value?.email ?? null)
// Synthetic phone-derived emails like "phone+998901234567@phone.memour.local"
// shouldn't be shown to the user — display the phone instead.
const displayEmail = computed(() => {
  if (!email.value) return null
  if (/@phone\.memour\.local$/.test(email.value)) return null
  return email.value
})

const localeOptions = computed(() =>
  (locales.value as Array<{ code: string; name: string }>),
)

const botUsername = 'QRFotografBot'

async function signOut() {
  await supabase.auth.signOut()
  await router.push(localePath('/dashboard/login'))
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h1 class="heading-display-md mb-6">Настройки</h1>

    <div class="flex flex-col gap-3">
      <!-- Account -->
      <div class="surface-card rounded-(--radius-xl) p-6">
        <p class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Аккаунт</p>
        <div class="mt-3 flex flex-col gap-1.5 text-sm">
          <p v-if="phone">
            <span class="text-(--color-muted-foreground)">Телефон:</span>
            <span class="ml-2 font-medium">{{ phone }}</span>
          </p>
          <p v-if="displayEmail">
            <span class="text-(--color-muted-foreground)">Email:</span>
            <span class="ml-2 font-medium">{{ displayEmail }}</span>
          </p>
        </div>
      </div>

      <!-- Language -->
      <div class="surface-card rounded-(--radius-xl) p-6">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 place-items-center rounded-full bg-(--color-accent)/40 text-(--color-primary)">
              <Globe class="h-5 w-5" :stroke-width="1.6" />
            </div>
            <div>
              <p class="font-medium">Язык интерфейса</p>
              <p class="text-xs text-(--color-muted-foreground)">Применяется ко всему кабинету</p>
            </div>
          </div>
          <div class="flex items-center gap-1 rounded-full border border-(--color-border) bg-white p-0.5">
            <NuxtLink
              v-for="l in localeOptions"
              :key="l.code"
              :to="switchLocalePath(l.code)"
              :class="[
                'rounded-full px-3 py-1 text-xs transition-colors',
                locale === l.code
                  ? 'bg-(--color-primary) text-(--color-primary-foreground)'
                  : 'text-(--color-muted-foreground) hover:text-(--color-foreground)',
              ]"
            >{{ l.code.toUpperCase() }}</NuxtLink>
          </div>
        </div>
      </div>

      <!-- Telegram -->
      <a
        :href="`https://t.me/${botUsername}`"
        target="_blank"
        rel="noopener"
        class="surface-card group flex items-center justify-between gap-4 rounded-(--radius-xl) p-6 transition-colors hover:bg-(--color-muted)/30"
      >
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-full bg-blue-100 text-blue-600">
            <MessageSquare class="h-5 w-5" :stroke-width="1.6" />
          </div>
          <div>
            <p class="font-medium">Telegram-бот</p>
            <p class="text-xs text-(--color-muted-foreground)">
              Получайте уведомления о новых фото и напоминание скачать архив
            </p>
          </div>
        </div>
        <ChevronRight class="h-5 w-5 text-(--color-muted-foreground) transition-transform group-hover:translate-x-1" />
      </a>

      <!-- Sign out -->
      <button
        type="button"
        class="surface-card group flex items-center justify-between gap-4 rounded-(--radius-xl) p-6 text-left transition-colors hover:bg-red-50"
        @click="signOut"
      >
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-full bg-red-100 text-red-600">
            <LogOut class="h-5 w-5" :stroke-width="1.6" />
          </div>
          <div>
            <p class="font-medium">Выйти из аккаунта</p>
            <p class="text-xs text-(--color-muted-foreground)">Закроет сессию на этом устройстве</p>
          </div>
        </div>
        <ChevronRight class="h-5 w-5 text-(--color-muted-foreground) transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  </div>
</template>
