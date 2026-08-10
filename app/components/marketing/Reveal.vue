<script setup lang="ts">
import { motion } from 'motion-v'

/**
 * Reveal — fade-up + opacity entrance on scroll-into-view. Mirrors
 * the Next.js helper used in pricing/lead form. Defaults: 0.7s
 * cubic-bezier, fires once, threshold 0.2 of element visible.
 */
withDefaults(
  defineProps<{
    delay?: number
    y?: number
    duration?: number
    amount?: number
    once?: boolean
  }>(),
  {
    delay: 0,
    y: 20,
    duration: 0.7,
    amount: 0.2,
    once: true,
  },
)
</script>

<template>
  <motion.div
    :initial="{ opacity: 0, y }"
    :while-in-view="{ opacity: 1, y: 0 }"
    :viewport="{ once, amount }"
    :transition="{ duration, delay, ease: [0.16, 1, 0.3, 1] }"
  >
    <slot />
  </motion.div>
</template>
