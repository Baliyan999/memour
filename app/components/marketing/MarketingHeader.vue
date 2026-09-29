<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { useI18n, useLocalePath, useSwitchLocalePath, useRoute } from '#imports'

/**
 * MarketingHeader — floating pill navbar made of a translucent
 * material: content scrolls underneath it, blurred. Once the page is
 * scrolled, a soft scroll-edge blur fades in behind the pill (instead
 * of a hard divider) and the material thickens — both are opacity
 * cross-fades of their own layers.
 *
 * Desktop (lg+): logo + anchor nav + locale switcher + login button.
 * Below lg: logo + locale switcher + compact login icon — the full nav
 * doesn't fit a portrait tablet (it used to wrap into the logo at
 * 768–840px). Users scroll to sections instead. On /privacy and
 * /terms the anchors lead back to the landing's sections.
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

// On the landing a plain #hash re-scrolls even when it's already in the
// URL; elsewhere the link has to navigate to the landing first.
const route = useRoute()
const onLanding = computed(() => route.path.replace(/\/$/, '') === localePath('/').replace(/\/$/, ''))

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
  <header class="site-header sticky top-3 z-50 md:top-5">
    <!-- Scroll-edge effect: a blur that fades out downward, only where
         content actually runs under the floating header. -->
    <div
      aria-hidden="true"
      :class="[
        'pointer-events-none absolute inset-x-0 -top-3 -z-10 h-[calc(100%+2.25rem)] bg-(--color-background)/45 backdrop-blur-md transition-opacity duration-(--spring-default) ease-(--ease-spring) [mask-image:linear-gradient(to_bottom,black_45%,transparent)] md:-top-5 md:h-[calc(100%+3rem)] reduce-transparency:bg-(--color-background)/90',
        scrolled ? 'opacity-100' : 'opacity-0',
      ]"
    />
    <div class="container-page">
      <div
        class="relative isolate mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 rounded-full pl-4 pr-2 md:h-16 md:pl-6 md:pr-3 xl:max-w-6xl 2xl:max-w-[80rem] 2xl:pl-7 3xl:h-20 3xl:max-w-[92rem] 3xl:pl-8 3xl:pr-4 4xl:h-24 4xl:max-w-[108rem]"
      >
        <!-- Material: resting layer + a thicker layer that fades in on scroll.
             The bright inset top edge reads as light catching the glass. -->
        <div
          aria-hidden="true"
          class="absolute inset-0 -z-10 rounded-full border border-white/50 bg-white/55 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_8px_28px_-12px_rgb(160_110_90/0.25)] backdrop-blur-xl backdrop-saturate-150 reduce-transparency:bg-white/95 reduce-transparency:backdrop-blur-none"
        />
        <div
          aria-hidden="true"
          :class="[
            'absolute inset-0 -z-10 rounded-full bg-white/40 shadow-[0_14px_40px_-14px_rgb(160_110_90/0.45)] transition-opacity duration-(--spring-default) ease-(--ease-spring)',
            scrolled ? 'opacity-100' : 'opacity-0',
          ]"
        />

        <NuxtLink
          :to="localePath('/')"
          class="press group flex items-center gap-2 whitespace-nowrap font-display text-base md:text-lg 3xl:gap-3 3xl:text-xl 4xl:text-2xl"
        >
          <img
            src="/memour-logo.png"
            alt=""
            width="32"
            height="32"
            class="h-7 w-7 md:h-8 md:w-8 3xl:h-10 3xl:w-10 4xl:h-12 4xl:w-12"
          >
          <span>Memour</span>
        </NuxtLink>

        <!-- Anchor nav — lg+ only. -->
        <nav class="hidden items-center gap-6 whitespace-nowrap text-sm lg:flex xl:gap-7 3xl:gap-10 3xl:text-base 4xl:gap-14 4xl:text-lg">
          <template v-for="item in navItems" :key="item.id">
            <a
              v-if="onLanding"
              :href="`#${item.id}`"
              class="group relative py-1 text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
            >
              {{ item.label }}
              <span class="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-(--color-primary) transition-transform duration-(--spring-default) ease-(--ease-spring) group-hover:scale-x-100" />
            </a>
            <NuxtLink
              v-else
              :to="{ path: localePath('/'), hash: `#${item.id}` }"
              class="group relative py-1 text-(--color-muted-foreground) transition-colors hover:text-(--color-foreground)"
            >
              {{ item.label }}
              <span class="absolute -bottom-0.5 left-0 h-px w-full origin-left scale-x-0 bg-(--color-primary) transition-transform duration-(--spring-default) ease-(--ease-spring) group-hover:scale-x-100" />
            </NuxtLink>
          </template>
        </nav>

        <div class="flex items-center gap-2">
          <!-- Locale switcher — single pill showing the ACTIVE locale.
               Tapping it navigates to the other locale; the visible
               label swaps with a horizontal slide-and-fade transition,
               keyed on `locale` so Vue knows to re-mount the inner
               span and run the enter/leave animation. The accessible
               name starts with the visible code (label-in-name). -->
          <NuxtLink
            :to="switchLocalePath(otherLocale)"
            :aria-label="`${String(locale).toUpperCase()} — ${t('nav.switchLocale')}`"
            class="press relative inline-flex h-8 min-w-[2.75rem] items-center justify-center overflow-hidden rounded-full bg-(--color-primary) px-3 text-[11px] font-medium uppercase tracking-widest text-(--color-primary-foreground) shadow-(--shadow-soft) md:h-9"
          >
            <Transition name="locale-swap" mode="out-in">
              <span :key="locale" class="block">{{ String(locale).toUpperCase() }}</span>
            </Transition>
          </NuxtLink>

          <!-- Login button — full text on lg+, icon-only below -->
          <NuxtLink
            :to="localePath('/dashboard')"
            class="press hidden h-9 items-center whitespace-nowrap rounded-full border border-(--color-border)/60 bg-white/80 px-4 text-sm font-medium backdrop-blur hover:bg-white lg:inline-flex"
          >
            {{ t('nav.loginCouple') }}
          </NuxtLink>
          <NuxtLink
            :to="localePath('/dashboard')"
            :aria-label="t('nav.loginCouple')"
            class="press grid h-10 w-10 place-items-center rounded-full border border-(--color-border)/60 bg-white/80 backdrop-blur hover:bg-white lg:hidden"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </NuxtLink>
        </div>
      </div>
    </div>
  </header>
</template>
