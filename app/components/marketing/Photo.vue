<script setup lang="ts">
import { computed } from 'vue'
import PHOTOS from './photo-manifest.json'

/**
 * Photo — one landing photo with its responsive webp variants
 * (scripts/optimize-images.mjs). Always lazy + async-decoded; the
 * landing photos illustrate the copy next to them, so they're
 * decorative (alt="") unless an alt is passed. `sizes` must describe
 * the slot's rendered CSS width — the browser then picks the smallest
 * variant that stays sharp at the device's pixel ratio.
 */
type PhotoName = keyof typeof PHOTOS

const props = withDefaults(
  defineProps<{
    name: PhotoName
    sizes: string
    alt?: string
    /** object-position, e.g. 'center 30%' */
    position?: string
  }>(),
  { alt: '', position: undefined },
)

const photo = computed(() => PHOTOS[props.name])
const src = computed(() => `/images/${props.name}-${photo.value.widths.at(-1)}.webp`)
const srcset = computed(() =>
  photo.value.widths.map((w) => `/images/${props.name}-${w}.webp ${w}w`).join(', '),
)
</script>

<template>
  <!-- loading/decoding first: a client-created <img> starts fetching as
       soon as src is set, so lazy has to be in place before it. -->
  <img
    loading="lazy"
    decoding="async"
    :sizes="sizes"
    :srcset="srcset"
    :src="src"
    :width="photo.width"
    :height="photo.height"
    :alt="alt"
    :style="position ? { objectPosition: position } : undefined"
  >
</template>
