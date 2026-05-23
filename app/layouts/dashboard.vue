<script setup lang="ts">
import { useI18n, useLocalePath } from '#imports'

/**
 * Dashboard layout — couple-facing chrome around the protected pages.
 * Minimal for now: floating header with logo + sign-out button, no
 * marketing footer. Sections below the header expand to full width
 * since dashboards rarely benefit from the same container as the
 * landing page.
 */
const { t } = useI18n()
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

async function signOut() {
  await supabase.auth.signOut()
  await router.push(localePath('/dashboard/login'))
}
</script>

<template>
  <div class="relative min-h-screen">
    <MarketingGlobalBackground />

    <header class="sticky top-3 z-50 md:top-5">
      <div class="container-page">
        <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 rounded-full border border-white/60 bg-white/85 pl-4 pr-2 shadow-[0_8px_28px_-12px_rgb(160_110_90_/_0.25)] backdrop-blur-xl md:h-16 md:pl-6 md:pr-3">
          <NuxtLink
            :to="localePath('/')"
            class="flex items-center gap-2 whitespace-nowrap font-display text-base md:text-lg"
          >
            <img src="/memour-logo.png" alt="Memour" width="32" height="32" class="h-7 w-7 md:h-8 md:w-8">
            <span>Memour</span>
          </NuxtLink>

          <div v-if="user" class="flex items-center gap-2">
            <NuxtLink
              :to="localePath('/dashboard/settings')"
              class="grid h-9 w-9 place-items-center rounded-full border border-(--color-border)/60 bg-white/80 text-(--color-muted-foreground) transition-colors hover:bg-white hover:text-(--color-foreground)"
              :aria-label="'Настройки'"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </NuxtLink>
          </div>
        </div>
      </div>
    </header>

    <main class="container-page relative py-10 md:py-14">
      <slot />
    </main>
  </div>
</template>
