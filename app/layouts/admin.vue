<script setup lang="ts">
import { useLocalePath } from '#imports'

/**
 * Admin layout — separate chrome from couple dashboard. Compact nav
 * with links between admin pages (events list, referrals, etc.) and
 * a sign-out button.
 */
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

async function signOut() {
  await supabase.auth.signOut()
  await router.push(localePath('/admin/login'))
}

const navLinks = [
  { to: '/admin', label: 'События' },
  { to: '/admin/leads', label: 'Лиды' },
  { to: '/admin/referrals', label: 'Рефералы' },
  { to: '/admin/team', label: 'Команда' },
]
</script>

<template>
  <div class="relative min-h-screen bg-(--color-background)">
    <MarketingGlobalBackground />

    <header class="sticky top-0 z-50 border-b border-(--color-border)/70 bg-white/85 backdrop-blur-xl">
      <div class="container-page flex h-14 items-center justify-between gap-4">
        <div class="flex items-center gap-6">
          <NuxtLink :to="localePath('/admin')" class="flex items-center gap-2 font-display text-lg">
            <img src="/memour-logo.png" alt="Memour" width="28" height="28" class="h-7 w-7">
            <span>Memour <span class="text-(--color-muted-foreground)">/ admin</span></span>
          </NuxtLink>
          <nav class="hidden gap-4 text-sm md:flex">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="localePath(link.to)"
              class="text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
              active-class="text-(--color-foreground)"
            >{{ link.label }}</NuxtLink>
          </nav>
        </div>
        <div v-if="user" class="flex items-center gap-3">
          <span class="hidden text-xs text-(--color-muted-foreground) sm:inline">{{ user.email }}</span>
          <button
            type="button"
            class="rounded-full border border-(--color-border)/60 bg-white px-3 py-1.5 text-xs hover:bg-(--color-muted)"
            @click="signOut"
          >Выйти</button>
        </div>
        <NuxtLink
          v-else
          :to="localePath('/')"
          class="inline-flex items-center gap-1.5 rounded-full border border-(--color-border) bg-white px-3 py-1.5 text-xs text-(--color-muted-foreground) hover:bg-(--color-muted)"
        >
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          На сайт
        </NuxtLink>
      </div>
    </header>

    <main class="container-page relative py-8 md:py-12">
      <slot />
    </main>
  </div>
</template>
