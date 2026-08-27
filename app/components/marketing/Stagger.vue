<script setup lang="ts">
import { motion } from 'motion-v'

/**
 * Stagger — staggered fade-up for direct children. Children should use
 * MarketingStaggerItem (or any motion.div consuming the same variants).
 */
withDefaults(
  defineProps<{
    step?: number
    delay?: number
    amount?: number
  }>(),
  { step: 0.08, delay: 0, amount: 0.2 },
)
</script>

<template>
  <motion.div
    initial="hidden"
    while-in-view="visible"
    :viewport="{ once: true, amount }"
    :variants="{
      hidden: {},
      visible: { transition: { staggerChildren: step, delayChildren: delay } },
    }"
  >
    <slot />
  </motion.div>
</template>
