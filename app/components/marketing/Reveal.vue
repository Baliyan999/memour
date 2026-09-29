<script setup lang="ts">
import { ref } from 'vue'
import { useReveal } from '~/composables/useMotion'

/**
 * Reveal — content settles up into place when it scrolls into view
 * (critically damped spring, see useReveal). SSR renders it fully
 * visible; only content still below the fold at mount is tucked away,
 * so nothing ever waits for JavaScript.
 */
const props = withDefaults(
  defineProps<{
    delay?: number
    y?: number
    amount?: number
  }>(),
  {
    delay: 0,
    y: undefined,
    amount: 0.2,
  },
)

const el = ref<HTMLElement | null>(null)
useReveal(el, { delay: props.delay, y: props.y, amount: props.amount })
</script>

<template>
  <div ref="el">
    <slot />
  </div>
</template>
