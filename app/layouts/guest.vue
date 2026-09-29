<script setup lang="ts">
/**
 * Guest layout — chromeless full-bleed shell for the /e/[id] flow.
 *
 * The language toggle used to live here as a floating top-right pill,
 * but on the capture screen it sat directly on top of the quota chip.
 * The page itself now owns the toggle — placing it inside the bottom
 * thumb-zone dock — so this layout stays a bare shell.
 *
 * Head overrides for every guest-facing page (capture + live):
 *   - viewport allows pinch-zoom (older guests read the small print);
 *     `touch-manipulation` on the controls kills double-tap zoom and
 *     the tap delay where it would get in the way of the shutter.
 *   - noindex: these are private wedding pages, not landing pages.
 */
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
  ],
})
useSeoMeta({ robots: 'noindex, nofollow' })
</script>

<template>
  <div class="relative min-h-[100dvh] bg-(--color-background)">
    <slot />
  </div>
</template>
