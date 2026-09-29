<script setup lang="ts">
/**
 * /refund — the refund policy is section 16 of the public offer (the
 * published documents give this address for it); until an offer is
 * published, the refund rules of the interim terms.
 */
const { salesTermsPath } = useLegal()
await navigateTo(salesTermsPath().replace(/#.*$/, '') + '#refund', { redirectCode: 302, replace: true })
</script>

<template>
  <div />
</template>
