<script setup lang="ts">
import { useI18n, useLocalePath } from '#imports'

const { t } = useI18n()
const localePath = useLocalePath()
// The public offer is linked once it is published (shared/legal.ts).
const { live: offerPublished } = useLegal()
const year = new Date().getFullYear()
</script>

<template>
  <footer class="relative border-t border-(--color-border)/70 py-14 3xl:py-20 4xl:py-24">
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 mx-auto h-px max-w-3xl"
      :style="{
        background:
          'linear-gradient(90deg, transparent, oklch(80% 0.06 35) 50%, transparent)',
      }"
    />
    <div class="container-page flex flex-col items-center gap-4 text-center text-sm text-(--color-muted-foreground) 3xl:gap-5 3xl:text-base 4xl:gap-6 4xl:text-lg">
      <div class="flex items-center gap-2.5 font-display text-2xl text-(--color-foreground) 3xl:text-3xl 4xl:text-4xl">
        <img
          src="/memour-logo.png"
          alt=""
          width="40"
          height="40"
          class="h-9 w-9 3xl:h-11 3xl:w-11 4xl:h-14 4xl:w-14"
        >
        Memour
      </div>
      <p class="max-w-md 3xl:max-w-lg 4xl:max-w-xl">{{ t('footer.tagline') }}</p>
      <!-- Wraps on narrow phones (Galaxy Fold, ru) instead of touching the
           edges; the · separators only show where the row fits on one line. -->
      <nav class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs 3xl:text-sm 4xl:text-base">
        <NuxtLink :to="localePath('/privacy')" class="py-1 hover:text-(--color-foreground)">
          {{ t('footer.privacy') }}
        </NuxtLink>
        <span aria-hidden="true" class="hidden sm:inline">·</span>
        <NuxtLink :to="localePath('/terms')" class="py-1 hover:text-(--color-foreground)">
          {{ t('footer.terms') }}
        </NuxtLink>
        <template v-if="offerPublished">
          <span aria-hidden="true" class="hidden sm:inline">·</span>
          <NuxtLink :to="localePath('/offer')" class="py-1 hover:text-(--color-foreground)">
            {{ t('footer.offer') }}
          </NuxtLink>
        </template>
        <span aria-hidden="true" class="hidden sm:inline">·</span>
        <a href="mailto:hello@memour.uz" class="py-1 hover:text-(--color-foreground)">hello@memour.uz</a>
      </nav>
      <p class="text-xs 3xl:text-sm 4xl:text-base">© {{ year }} · {{ t('footer.rights') }}</p>
    </div>
  </footer>
</template>
