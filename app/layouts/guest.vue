<script setup lang="ts">
/**
 * Guest layout — chromeless full-bleed shell for the /e/[id] flow.
 *
 * The language toggle used to live here as a floating top-right pill,
 * but on the capture screen it sat directly on top of the quota chip.
 * The page itself now owns the toggle — placing it inside the bottom
 * thumb-zone dock — so this layout stays a bare shell.
 */
</script>

<template>
  <div class="relative min-h-[100dvh] bg-(--color-background)">
    <slot />
  </div>
</template>
