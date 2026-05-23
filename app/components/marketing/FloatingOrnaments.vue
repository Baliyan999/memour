<script setup lang="ts">
import { computed } from 'vue'

/**
 * FloatingOrnaments — deterministic warm decorative dots scattered
 * across a section. Density / hue can be tuned per-section so each
 * page area gets its own colour signature without needing imagery.
 *
 * Positions/sizes derive from index so SSR and client agree (no
 * Math.random hydration mismatches).
 */
const props = withDefaults(
  defineProps<{
    count?: number
    hueBase?: number
    hueSpread?: number
  }>(),
  {
    count: 8,
    hueBase: 30,
    hueSpread: 50,
  },
)

const dots = computed(() =>
  Array.from({ length: props.count }, (_, i) => {
    const seed = (i * 73) % 100
    const seed2 = (i * 137) % 100
    const seed3 = (i * 211) % 100
    return {
      key: i,
      left: `${seed}%`,
      top: `${seed2}%`,
      size: 3 + (seed3 % 6),
      hue: props.hueBase + ((i * 17) % props.hueSpread),
      delay: (i * 0.7) % 6,
    }
  }),
)
</script>

<template>
  <div aria-hidden="true" class="pointer-events-none absolute inset-0 overflow-hidden">
    <span
      v-for="d in dots"
      :key="d.key"
      class="animate-star-twinkle absolute rounded-full"
      :style="{
        left: d.left,
        top: d.top,
        width: `${d.size}px`,
        height: `${d.size}px`,
        background: `radial-gradient(circle, oklch(85% 0.08 ${d.hue}), oklch(72% 0.12 ${d.hue + 15}) 70%, transparent 100%)`,
        animationDelay: `${d.delay}s`,
        opacity: 0.4,
      }"
    />
  </div>
</template>
