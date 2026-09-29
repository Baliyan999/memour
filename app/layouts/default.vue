<script setup lang="ts">
import { onMounted } from 'vue'

// Marketing layout with floating header, animated background, and footer.

// iOS Safari only applies :active (our press feedback) when a touchstart
// listener exists up the tree — a passive no-op is enough.
onMounted(() => {
  document.addEventListener('touchstart', () => {}, { passive: true })
})
</script>

<template>
  <div class="relative">
    <MarketingGlobalBackground />
    <MarketingHeader />
    <main class="relative">
      <slot />
    </main>
    <MarketingFooter />
  </div>
</template>
