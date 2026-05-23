<script setup lang="ts">
import { useI18n, useLocalePath } from '#imports'

const { t, locale } = useI18n()
const localePath = useLocalePath()
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
          alt="Memour"
          width="40"
          height="40"
          class="h-9 w-9 3xl:h-11 3xl:w-11 4xl:h-14 4xl:w-14"
        >
        Memour
      </div>
      <p class="max-w-md 3xl:max-w-lg 4xl:max-w-xl">{{ t('footer.tagline') }}</p>
      <nav class="flex items-center gap-4 text-xs 3xl:text-sm 4xl:text-base">
        <NuxtLink :to="localePath('/privacy')" class="hover:text-(--color-foreground)">
          {{ locale === 'uz' ? 'Maxfiylik' : 'Конфиденциальность' }}
        </NuxtLink>
        <span aria-hidden="true">·</span>
        <NuxtLink :to="localePath('/terms')" class="hover:text-(--color-foreground)">
          {{ locale === 'uz' ? 'Shartlar' : 'Условия' }}
        </NuxtLink>
        <span aria-hidden="true">·</span>
        <a href="mailto:hello@memour.uz" class="hover:text-(--color-foreground)">hello@memour.uz</a>
      </nav>
      <p class="text-xs 3xl:text-sm 4xl:text-base">© {{ year }} · {{ t('footer.rights') }}</p>
    </div>
  </footer>
</template>
