<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n, useSwitchLocalePath, useLocalePath } from '#imports'
import { motion } from 'motion-v'
import { Globe, Send, LogOut, ChevronRight } from '@lucide/vue'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/settings — couple's account preferences.
 *
 * Sections:
 *   • Language (links to the locale-switched copy of this same page)
 *   • Telegram bot — chats are connected per wedding, on the event
 *     page (components/dashboard/TelegramCard.vue). The card leads
 *     there: straight to the Telegram section when the account has one
 *     event, to the event list otherwise.
 *   • Sign out
 */
const { t, locale, locales } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()
const supabase = useSupabaseClient<Database>()
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
  (locales.value as Array<{ code: 'ru' | 'uz'; name: string }>),
)

// RLS returns only this account's events; two rows are enough to know
// whether there is a single wedding to go to.
const { data: eventIds } = await useAsyncData('settings-event-ids', async () => {
  const { data } = await supabase.from('events').select('id').limit(2)
  return (data ?? []).map((e) => e.id)
})
const telegramTo = computed(() => eventIds.value?.length === 1
  ? `${localePath(`/dashboard/event/${eventIds.value[0]}`)}#telegram`
  : localePath('/dashboard'))

const { toast } = useToast()
const signingOut = ref(false)

// scope 'local': the couple often shares one account on two phones —
// signing out here must not kill the partner's session ("this device").
async function signOut() {
  if (signingOut.value) return
  signingOut.value = true
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) {
    signingOut.value = false
    toast.error(t('couple.settings.signOutFailed'))
    return
  }
  await router.push(localePath('/dashboard/login'))
}
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h1 class="heading-display-md mb-6">{{ t('couple.settings.title') }}</h1>

    <div class="flex flex-col gap-3">
      <!-- Account -->
      <div class="surface-card rounded-(--radius-xl) p-6">
        <p class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">
          {{ t('couple.settings.account') }}
        </p>
        <div class="mt-3 flex flex-col gap-1.5 text-sm">
          <p v-if="phone">
            <span class="text-(--color-muted-foreground)">{{ t('couple.settings.phoneLabel') }}:</span>
            <span class="ml-2 font-medium">{{ phone }}</span>
          </p>
          <p v-if="displayEmail">
            <span class="text-(--color-muted-foreground)">{{ t('couple.settings.emailLabel') }}:</span>
            <span class="ml-2 font-medium">{{ displayEmail }}</span>
          </p>
        </div>
      </div>

      <!-- Language -->
      <div class="surface-card rounded-(--radius-xl) p-6">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--color-accent)/40 text-(--color-primary)">
              <Globe class="h-5 w-5" :stroke-width="1.6" />
            </div>
            <div>
              <p class="font-medium">{{ t('couple.settings.languageTitle') }}</p>
              <p class="text-xs text-(--color-muted-foreground)">{{ t('couple.settings.languageHint') }}</p>
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

      <!-- Telegram — connected per wedding, on its page -->
      <NuxtLink
        :to="telegramTo"
        class="surface-card group flex items-center justify-between gap-4 rounded-(--radius-xl) p-6 transition-[background-color,transform] duration-150 hover:bg-(--color-muted)/30 active:scale-[0.99]"
      >
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-600">
            <Send class="h-5 w-5" :stroke-width="1.6" />
          </div>
          <div>
            <p class="font-medium">{{ t('couple.settings.telegramTitle') }}</p>
            <p class="text-xs text-(--color-muted-foreground)">
              {{ t('couple.settings.telegramHint') }}
            </p>
          </div>
        </div>
        <ChevronRight class="h-5 w-5 shrink-0 text-(--color-muted-foreground) transition-transform group-hover:translate-x-1" />
      </NuxtLink>

      <!-- Sign out -->
      <button
        type="button"
        :disabled="signingOut"
        class="surface-card group flex w-full items-center justify-between gap-4 rounded-(--radius-xl) p-6 text-left transition-[background-color,transform] duration-150 hover:bg-red-50 active:scale-[0.99] disabled:opacity-60"
        @click="signOut"
      >
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-600">
            <LogOut class="h-5 w-5" :stroke-width="1.6" />
          </div>
          <div>
            <p class="font-medium">{{ t('couple.settings.signOutTitle') }}</p>
            <p class="text-xs text-(--color-muted-foreground)">{{ t('couple.settings.signOutHint') }}</p>
          </div>
        </div>
        <ChevronRight class="h-5 w-5 text-(--color-muted-foreground) transition-transform group-hover:translate-x-1" />
      </button>
    </div>
  </div>
</template>
