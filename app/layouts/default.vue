<script setup lang="ts">
// Marketing layout with floating header, animated background, and footer.
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
