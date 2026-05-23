<script setup lang="ts">
/**
 * Guest layout — chromeless full-bleed shell for the /e/[id] flow.
 * No marketing header, no footer; the page itself paints the brand.
 * Anonymous viewers, designed for phone screens.
 */
</script>

<template>
  <div class="relative min-h-[100dvh] bg-(--color-background)">
    <slot />
  </div>
</template>
