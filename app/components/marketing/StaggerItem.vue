<script setup lang="ts">
import { motion } from 'motion-v'
</script>

<template>
  <motion.div
    :variants="{
      hidden: { opacity: 0, y: 24 },
      visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
      },
    }"
  >
    <slot />
  </motion.div>
</template>
