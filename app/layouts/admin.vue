<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n, useLocalePath } from '#imports'

/**
 * Admin layout — separate chrome from couple dashboard.
 *
 * The chrome (nav + email) only renders for users who are CONFIRMED
 * admins (row exists in `public.admins`). A regular couple-user who
 * stumbles onto /admin shouldn't see the admin navigation or have
 * their synthetic phone-derived email exposed in the header.
 *
 * We check admin status reactively; while the check is in flight the
 * chrome stays minimal (just the logo + back-to-site link).
 *
 * Never on /admin/login: a Supabase session without the Telegram step
 * (the 2FA cookie expires after 8 h, or an email magic link) lands
 * there, and every nav link would just bounce back to the login. Every
 * other admin page is behind the full check in middleware/auth.global.
 */
const { t } = useI18n()
const localePath = useLocalePath()
const supabase = useSupabaseClient()
const user = useSupabaseUser()
const router = useRouter()

const isAdmin = ref(false)
const adminEmail = ref<string | null>(null)

watch(
  user,
  async (u) => {
    if (!u) {
      isAdmin.value = false
      adminEmail.value = null
      return
    }
    const uid = (u as any).id ?? (u as any).sub
    const { data } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle()
    isAdmin.value = !!data
    // Don't expose synthetic phone+998…@phone.memour.local emails —
    // those belong to couple-side users who happened to authenticate
    // before landing on an admin URL.
    const email = (u as any).email as string | undefined
    adminEmail.value = email && !/@phone\.memour\.local$/.test(email) ? email : null
  },
  { immediate: true },
)

async function signOut() {
  // The 2FA cookie dies with the Supabase session anyway; don't leave it lying around.
  await $fetch('/api/admin-auth/logout', { method: 'POST' }).catch(() => {})
  await supabase.auth.signOut()
  await router.push(localePath('/admin/login'))
}

const route = useRoute()
const showChrome = computed(() => isAdmin.value && !route.path.replace(/\/$/, '').endsWith('/admin/login'))
function isCurrent(to: string) {
  return route.path.replace(/\/$/, '') === localePath(to)
}

const navLinks = computed(() => [
  { to: '/admin', label: t('admin.nav.events') },
  { to: '/admin/leads', label: t('admin.nav.leads') },
  { to: '/admin/referrals', label: t('admin.nav.referrals') },
  { to: '/admin/team', label: t('admin.nav.team') },
])
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

          <!-- Nav only when actually an admin — otherwise the links
               look clickable but middleware would just bounce. -->
          <nav v-if="showChrome" class="hidden gap-4 text-sm md:flex">
            <NuxtLink
              v-for="link in navLinks"
              :key="link.to"
              :to="localePath(link.to)"
              class="text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
              active-class="text-(--color-foreground)"
            >{{ link.label }}</NuxtLink>
          </nav>
        </div>

        <div v-if="showChrome" class="flex items-center gap-3">
          <span v-if="adminEmail" class="hidden text-xs text-(--color-muted-foreground) sm:inline">{{ adminEmail }}</span>
          <button
            type="button"
            class="rounded-full border border-(--color-border)/60 bg-white px-3 py-1.5 text-xs hover:bg-(--color-muted)"
            @click="signOut"
          >{{ t('admin.nav.signOut') }}</button>
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
          {{ t('admin.nav.toSite') }}
        </NuxtLink>
      </div>

      <!-- Phones / small tablets: the nav above is hidden, so the
           sections live in a scrollable tab strip under the header. -->
      <nav
        v-if="showChrome"
        class="container-page flex gap-1.5 overflow-x-auto border-t border-(--color-border)/60 py-2 text-sm md:hidden"
        :aria-label="t('admin.nav.sections')"
      >
        <NuxtLink
          v-for="link in navLinks"
          :key="link.to"
          :to="localePath(link.to)"
          :class="[
            'shrink-0 rounded-full px-3 py-1.5 transition-[transform,background-color,color] duration-150 active:scale-95 motion-reduce:transition-colors motion-reduce:active:scale-100',
            isCurrent(link.to)
              ? 'bg-(--color-primary) text-(--color-primary-foreground)'
              : 'text-(--color-muted-foreground)',
          ]"
        >{{ link.label }}</NuxtLink>
      </nav>
    </header>

    <main class="container-page relative py-8 md:py-12">
      <slot />
    </main>
  </div>
</template>
