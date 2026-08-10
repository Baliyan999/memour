<script setup lang="ts">
/**
 * Ornaments — tiny decorative SVGs reused across the landing.
 *
 * The original Next.js project had Rings + Sparkle + GoldDot as
 * separate named exports; here they're combined as one SFC that
 * switches by `kind` prop to keep the file count down. Each kind
 * mirrors the original markup and palette 1:1.
 */
defineProps<{
  kind: 'rings' | 'sparkle' | 'gold-dot'
  size?: number | string
  className?: string
  /** Sparkle absolute position */
  x?: string
  y?: string
  delay?: number
}>()
</script>

<template>
  <!-- Rings: two interlocked circles in gold gradient -->
  <svg
    v-if="kind === 'rings'"
    aria-hidden="true"
    viewBox="0 0 400 200"
    :width="size ?? 380"
    :height="typeof size === 'number' ? (size * 200) / 400 : '50%'"
    preserveAspectRatio="xMidYMid meet"
    :class="className"
  >
    <defs>
      <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="oklch(72% 0.08 50)" />
        <stop offset="50%" stop-color="oklch(85% 0.06 70)" />
        <stop offset="100%" stop-color="oklch(60% 0.09 30)" />
      </linearGradient>
    </defs>
    <circle cx="140" cy="100" r="78" stroke="url(#ring-grad)" stroke-width="3.5" fill="none" />
    <circle cx="240" cy="100" r="78" stroke="url(#ring-grad)" stroke-width="3.5" fill="none" />
  </svg>

  <!-- Sparkle: 4-point star with absolute positioning, infinite pulse -->
  <svg
    v-else-if="kind === 'sparkle'"
    aria-hidden="true"
    viewBox="0 0 20 20"
    :width="size ?? 14"
    :height="size ?? 14"
    class="absolute"
    :style="{
      left: x,
      top: y,
      animation: `pulse-sparkle 2.6s ease-in-out infinite`,
      animationDelay: `${delay ?? 0}s`,
    }"
  >
    <path
      d="M10 0 L11.5 8.5 L20 10 L11.5 11.5 L10 20 L8.5 11.5 L0 10 L8.5 8.5 Z"
      fill="oklch(80% 0.1 75)"
    />
  </svg>

  <!-- Gold dot: simple circle -->
  <span
    v-else-if="kind === 'gold-dot'"
    aria-hidden="true"
    :class="['inline-block rounded-full bg-(--color-primary)', className]"
    :style="{ width: size ?? 6 + 'px', height: size ?? 6 + 'px' }"
  />
</template>

<style scoped>
@keyframes pulse-sparkle {
  0%, 100% { opacity: 0; transform: scale(0.4); }
  50% { opacity: 1; transform: scale(1.1); }
}
</style>
