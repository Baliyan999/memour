<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useSwitchLocalePath } from '#imports'

/**
 * Guest layout — chromeless full-bleed shell for the /e/[id] flow.
 * No marketing header, no footer; the page itself paints the brand.
 *
 * The one piece of chrome we DO render is a tiny language pill in the
 * top-right corner. Guests scanning the QR may speak either Russian
 * or Uzbek; the pill swaps the current path between locales while
 * preserving the `?t=` query, so the table they scanned stays sticky.
 */
const { locale } = useI18n()
const switchLocalePath = useSwitchLocalePath()

const otherLocale = computed<'ru' | 'uz'>(() => (locale.value === 'ru' ? 'uz' : 'ru'))
const otherLabel = computed(() => (locale.value === 'ru' ? "O'zbekcha" : 'Русский'))
</script>

<template>
  <div class="relative min-h-[100dvh] bg-(--color-background)">
    <NuxtLink
      :to="switchLocalePath(otherLocale)"
      class="absolute right-4 top-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-(--color-border)/50 bg-white/70 px-3 py-1.5 text-[11px] font-medium tracking-wide text-(--color-muted-foreground) shadow-[0_2px_12px_rgb(0_0_0_/_0.04)] backdrop-blur-md transition-all hover:bg-white/95 hover:text-(--color-foreground)"
      :aria-label="otherLabel"
    >
      <!-- Subtle inline swap glyph; keeps the chip recognizable even
           before the user reads the label -->
      <svg viewBox="0 0 24 24" class="h-3 w-3 opacity-60" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7h13l-3-3" />
        <path d="M21 17H8l3 3" />
      </svg>
      {{ otherLabel }}
    </NuxtLink>
    <slot />
  </div>
</template>
