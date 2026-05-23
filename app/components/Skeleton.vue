<script setup lang="ts">
/**
 * Skeleton — shimmer placeholder block. Use it to occupy space while
 * `useFetch` / `useAsyncData` is pending so the page doesn't flash
 * empty. Honors prefers-reduced-motion (the keyframe in main.css is
 * suppressed under that media query).
 */
withDefaults(
  defineProps<{
    /** Tailwind class set or inline style, applied to the block */
    class?: string
    /** Shape preset */
    shape?: 'rect' | 'circle' | 'text'
    /** Rounded radius preset */
    rounded?: 'sm' | 'md' | 'lg' | 'full'
  }>(),
  { shape: 'rect', rounded: 'md' },
)
</script>

<template>
  <div
    :class="[
      'animate-pulse bg-gradient-to-r from-(--color-muted) via-(--color-accent)/40 to-(--color-muted) bg-[length:200%_100%] [animation:shimmer_2s_linear_infinite]',
      shape === 'circle' ? 'rounded-full aspect-square' : '',
      rounded === 'sm' ? 'rounded-sm' :
      rounded === 'md' ? 'rounded-md' :
      rounded === 'lg' ? 'rounded-lg' :
      rounded === 'full' ? 'rounded-full' : '',
      $props.class,
    ]"
  />
</template>
