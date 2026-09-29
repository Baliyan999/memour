<script setup lang="ts">
import { ref, defineComponent, h, type PropType } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform } from 'motion-v'
import { useReveal } from '~/composables/useMotion'
import MarketingPhoto from './Photo.vue'

/**
 * GalleryPreview — photo mosaic showing how guests' shots aggregate
 * into one album. The scene keeps a fixed aspect ratio (2.3:1, 1.75:1
 * on phones so the tiny tiles there overlap less) so the
 * percentage-positioned tiles never overflow when the page width
 * grows. Tiles settle in one after another on the shared spring
 * reveal, with subtle scene-wide scale + rotateX driven by the
 * section's scroll progress (off under reduced motion).
 */
const { t } = useI18n()

const TILES = [
  { ar: '3/4', photo: 'rings', x: 4,  y: 6,  w: 20, rot: -2 },
  { ar: '1/1', photo: 'champagne', x: 28, y: 2,  w: 22, rot: 1 },
  { ar: '4/5', photo: 'bouquet', x: 56, y: 8,  w: 20, rot: -1.5 },
  { ar: '1/1', photo: 'couple-back', x: 80, y: 4,  w: 18, rot: 2, position: 'center 85%' },
  { ar: '4/3', photo: 'embrace', x: 6,  y: 50, w: 24, rot: 1.5, position: 'center 30%' },
  { ar: '3/4', photo: 'guests', x: 36, y: 34, w: 20, rot: -2 },
  { ar: '1/1', photo: 'candles', x: 62, y: 50, w: 20, rot: 2 },
  { ar: '4/5', photo: 'table-setting', x: 84, y: 46, w: 14, rot: -1, position: 'center 40%' },
] as const

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start end', 'end start'],
})

const sceneScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 0.97])
const sceneRotateX = useTransform(scrollYProgress, [0, 0.5, 1], [8, 0, -4])

// Scene max-width per breakpoint (px) → each tile's rendered width is
// w% of it; below 1064px the scene is the viewport minus gutters.
const SCENE_WIDTHS: [number, number][] = [[2560, 1920], [1920, 1600], [1536, 1408], [1280, 1152], [1064, 1024]]
const tileSizes = (w: number) =>
  [...SCENE_WIDTHS.map(([mq, scene]) => `(min-width: ${mq}px) ${Math.round((scene * w) / 100)}px`), `${w}vw`].join(', ')

// Single tile: positioned box (revealed by the scene's stagger) with
// the photo frame inside it. The static tilt uses the CSS `rotate`
// property so it composes with the reveal's transform. The mat is
// thinner on phones, where a tile is only ~70 px wide; the photo's
// corner is the mat's corner minus the mat.
// Photos: none of the album grid in «How it works» right above
// (HowSceneAlbum), so the two never show the same shot on one screen.
const Tile = defineComponent({
  props: {
    tile: { type: Object as PropType<(typeof TILES)[number]>, required: true },
  },
  setup(p) {
    return () =>
      h(
        'div',
        {
          'data-tile': '',
          class: 'absolute',
          style: {
            left: `${p.tile.x}%`,
            top: `${p.tile.y}%`,
            width: `${p.tile.w}%`,
            aspectRatio: p.tile.ar,
          },
        },
        h(
          'div',
          {
            class:
              'group relative h-full w-full overflow-hidden rounded-[6px] bg-white p-1 sm:rounded-(--radius-md) sm:p-2',
            style: {
              rotate: `${p.tile.rot}deg`,
              border: '1px solid oklch(94% 0.015 70)',
              boxShadow: 'var(--shadow-soft)',
            },
          },
          h(
            'div',
            {
              class: 'relative h-full w-full overflow-hidden rounded-[2px] bg-(--color-muted) sm:rounded-[6px]',
            },
            [
              h(MarketingPhoto, {
                name: p.tile.photo,
                sizes: tileSizes(p.tile.w),
                position: 'position' in p.tile ? p.tile.position : undefined,
                class: 'absolute inset-0 h-full w-full object-cover',
              }),
              h('div', {
                'aria-hidden': true,
                class:
                  'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100',
                style: {
                  background:
                    'linear-gradient(115deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%)',
                },
              }),
            ],
          ),
        ),
      )
  },
})

const headRef = ref<HTMLElement | null>(null)
const sceneRef = ref<HTMLElement | null>(null)
useReveal(headRef, { items: '[data-reveal]', stagger: 0.08 })
useReveal(sceneRef, { items: '[data-tile]', stagger: 0.06, y: 24, amount: 0.1 })
</script>

<template>
  <section
    ref="sectionRef"
    class="relative overflow-x-clip py-16 md:py-20 2xl:py-24 3xl:py-28 4xl:py-36"
  >
    <MarketingFloatingOrnaments :count="6" :hue-base="30" />

    <div class="container-page relative">
      <div ref="headRef" class="mx-auto mb-8 text-center md:mb-10 3xl:mb-14 4xl:mb-16">
        <p data-reveal aria-hidden="true" class="mb-3 text-xs uppercase tracking-[0.3em] text-(--color-primary)">
          ⋄ ⋄ ⋄
        </p>
        <!-- Width in em so the title keeps two lines as the display size
             grows; a fixed 672px box squeezed it into four on 4K. -->
        <h2 data-reveal class="heading-display-lg mx-auto max-w-[11em] text-balance">{{ t('gallery.title') }}</h2>
        <p data-reveal class="mx-auto mt-4 max-w-2xl text-(--color-muted-foreground)">
          {{ t('gallery.subtitle') }}
        </p>
      </div>

      <motion.div
        :style="{
          scale: sceneScale,
          rotateX: sceneRotateX,
          transformPerspective: 1400,
          transformStyle: 'preserve-3d',
        }"
        class="relative mx-auto aspect-[1.75/1] max-w-5xl sm:aspect-[2.3/1] xl:max-w-6xl 2xl:max-w-[88rem] 3xl:max-w-[100rem] 4xl:max-w-[120rem] motion-reduce:transform-none!"
      >
        <div ref="sceneRef" class="absolute inset-0">
          <Tile v-for="(tile, i) in TILES" :key="i" :tile="tile" />
        </div>
      </motion.div>
    </div>
  </section>
</template>
