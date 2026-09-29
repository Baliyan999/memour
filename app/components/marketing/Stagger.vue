<script setup lang="ts">
import { ref } from 'vue'
import { useReveal } from '~/composables/useMotion'

/**
 * Stagger — reveals its MarketingStaggerItem children one after
 * another when the group scrolls into view. The whole group triggers
 * together, so cards parked off-screen in a mobile carousel are ready
 * by the time they're swiped in.
 */
const props = withDefaults(
  defineProps<{
    step?: number
    delay?: number
    amount?: number
  }>(),
  { step: 0.08, delay: 0, amount: 0.2 },
)

const el = ref<HTMLElement | null>(null)
useReveal(el, { items: ':scope > [data-stagger-item]', stagger: props.step, delay: props.delay, amount: props.amount })
</script>

<template>
  <div ref="el">
    <slot />
  </div>
</template>
