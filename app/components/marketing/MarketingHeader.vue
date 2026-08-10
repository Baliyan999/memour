<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n, useLocalePath, useSwitchLocalePath } from '#imports'

/**
 * MarketingHeader — floating pill navbar.
 *
 * Desktop (md+): logo + anchor nav + locale switcher + login button.
 * Mobile (< md): logo + locale switcher + compact login icon. The
 * dropdown menu and inline anchor links are gone on mobile — the user
 * scrolls to sections instead.
 *
 * Locale switcher shows ONLY the current locale code (e.g. "UZ") and
 * tapping it navigates to the OTHER locale. The label swaps with a
 * horizontal slide-and-fade so the change feels tactile — old letter
 * exits left, new one comes in from the right.
 */
const { t, locale, locales } = useI18n()
const localePath = useLocalePath()
const switchLocalePath = useSwitchLocalePath()

const scrolled = ref(false)

function onScroll() {
  scrolled.value = window.scrollY > 12
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})

const navItems = computed(() => [
  { id: 'how', label: t('nav.howItWorks') },
  { id: 'features', label: t('nav.features') },
  { id: 'pricing', label: t('nav.pricing') },
  { id: 'lead', label: t('nav.contact') },
])

// The "other" locale = the one the user will switch to when clicking
// the pill. Currently displayed is locale.value (active).
const otherLocale = computed(() => {
  const all = (locales.value as Array<{ code: 'ru' | 'uz' }>).map((l) => l.code)
  return all.find((c) => c !== locale.value) ?? 'uz'
})
</script>

<template>
  <header class="sticky top-3 z-50 md:top-5">
    <div class="container-page">
      <div
        :class="[
          'mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 rounded-full border pl-4 pr-2 transition-all duration-300 md:h-16 md:pl-6 md:pr-3 xl:max-w-6xl 2xl:max-w-[80rem] 2xl:pl-7 3xl:h-20 3xl:max-w-[92rem] 3xl:pl-8 3xl:pr-4 4xl:h-24 4xl:max-w-[108rem]',
          scrolled
            ? 'border-white/60 bg-white/85 shadow-[0_14px_40px_-14px_rgb(160_110_90_/_0.45)] backdrop-blur-2xl'
            : 'border-white/40 bg-white/55 shadow-[0_8px_28px_-12px_rgb(160_110_90_/_0.25)] backdrop-blur-xl',
        ]"
      >
        <NuxtLink
          :to="localePath('/')"
          class="group flex items-center gap-2 whitespace-nowrap font-display text-base md:text-lg 3xl:gap-3 3xl:text-xl 4xl:text-2xl"
        >
          <img
            src="/memour-logo.png"
            alt="Memour"
            width="32"
            height="32"
            class="h-7 w-7 md:h-8 md:w-8 3xl:h-10 3xl:w-10 4xl:h-12 4xl:w-12"
          >
          <span>Memour</span>
        </NuxtLink>

        <!-- Anchor nav — visible only on md+. On mobile users scroll. -->
        <nav class="hidden items-center gap-7 text-sm md:flex 3xl:gap-10 3xl:text-base 4xl:gap-14 4xl:text-lg">
          <a
            v-for="item in navItems"
            :key="item.id"
            :href="`#${item.id}`"
            class="group relative text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
          >
            {{ item.label }}
            <span class="absolute -bottom-1 left-0 h-px w-0 bg-(--color-primary) transition-all duration-300 group-hover:w-full" />
          </a>
        </nav>

        <div class="flex items-center gap-2">
          <!-- Locale switcher — single pill showing the ACTIVE locale.
               Tapping it navigates to the other locale; the visible
               label swaps with a horizontal slide-and-fade transition,
               keyed on `locale` so Vue knows to re-mount the inner
               span and run the enter/leave animation. -->
          <NuxtLink
            :to="switchLocalePath(otherLocale)"
            :aria-label="`Switch to ${otherLocale.toUpperCase()}`"
            class="relative inline-flex h-7 min-w-[2.5rem] items-center justify-center overflow-hidden rounded-full bg-(--color-primary) px-3 text-[10px] uppercase tracking-widest text-(--color-primary-foreground) shadow-(--shadow-soft) transition-transform duration-200 hover:scale-105 active:scale-95 md:h-8"
          >
            <Transition name="locale-swap" mode="out-in">
              <span :key="locale" class="block">{{ String(locale).toUpperCase() }}</span>
            </Transition>
          </NuxtLink>

          <!-- Login button — full text on md+, icon-only on mobile -->
          <NuxtLink
            :to="localePath('/dashboard')"
            class="hidden h-9 items-center rounded-full border border-(--color-border)/60 bg-white/80 px-4 text-sm font-medium backdrop-blur transition-colors hover:bg-white md:inline-flex"
          >
            {{ t('nav.loginCouple') }}
          </NuxtLink>
          <NuxtLink
            :to="localePath('/dashboard')"
            :aria-label="t('nav.loginCouple')"
            class="grid h-10 w-10 place-items-center rounded-full border border-(--color-border)/60 bg-white/80 backdrop-blur transition-colors hover:bg-white md:hidden"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </NuxtLink>
        </div>
      </div>
    </div>
  </header>
</template>
