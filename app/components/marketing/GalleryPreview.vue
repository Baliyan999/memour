<script setup lang="ts">
import { ref, defineComponent, h, type PropType } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'motion-v'

/**
 * GalleryPreview — photo mosaic showing how guests' shots aggregate
 * into one album. The scene maintains a 2.3:1 aspect ratio so the
 * percentage-positioned tiles never overflow when the page width
 * grows. Each tile fades / rotates in on enter, with subtle scene-wide
 * scale + rotateX driven by the section's scroll progress.
 */
const { t } = useI18n()
const reduce = useReducedMotion()

const TILES = [
  { ar: '3/4', src: '/images/rings.webp', x: 4,  y: 6,  w: 20, rot: -2 },
  { ar: '1/1', src: '/images/champagne.webp', x: 28, y: 2,  w: 22, rot: 1 },
  { ar: '4/5', src: '/images/bouquet.webp', x: 56, y: 8,  w: 20, rot: -1.5 },
  { ar: '1/1', src: '/images/couple-back.webp', x: 80, y: 4,  w: 18, rot: 2 },
  { ar: '4/3', src: '/images/dance.webp', x: 6,  y: 50, w: 24, rot: 1.5 },
  { ar: '3/4', src: '/images/guests.webp', x: 36, y: 34, w: 20, rot: -2 },
  { ar: '1/1', src: '/images/candles.webp', x: 62, y: 50, w: 20, rot: 2 },
  { ar: '4/5', src: '/images/table-setting.webp', x: 84, y: 46, w: 14, rot: -1 },
] as const

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start end', 'end start'],
})

const sceneScale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1, 0.97])
const sceneRotateX = useTransform(scrollYProgress, [0, 0.5, 1], [8, 0, -4])

// Single tile component — each subscribes to its own rotate transform.
const ParallaxTile = defineComponent({
  props: {
    index: { type: Number, required: true },
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    tile: { type: Object as PropType<(typeof TILES)[number]>, required: true },
    reduce: { type: Boolean, required: true },
  },
  setup(p) {
    // Tile sits at its own static rotation (`tile.rot`, ±2deg per tile)
    // so the mosaic still has organic variation. Removed the
    // scroll-linked ±2deg sweep AND the 3D rotateY entrance —
    // both were making cards look "tilted then straightening" on
    // first paint, which the user found jarring. Now tiles just
    // fade in at their final position.
    return () =>
      h(
        motion.div,
        {
          style: {
            rotate: p.tile.rot,
            left: `${p.tile.x}%`,
            top: `${p.tile.y}%`,
            width: `${p.tile.w}%`,
            aspectRatio: p.tile.ar,
          },
          class: 'absolute',
          initial: p.reduce ? { opacity: 1 } : { opacity: 0, y: 16 },
          whileInView: p.reduce ? { opacity: 1 } : { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.05, margin: '0px 0px -10% 0px' },
          transition: { duration: 0.7, delay: p.reduce ? 0 : p.index * 0.06, ease: [0.16, 1, 0.3, 1] },
        },
        () =>
          h(
            'div',
            {
              class:
                'group relative h-full w-full overflow-hidden rounded-(--radius-md) bg-white p-2',
              style: {
                border: '1px solid oklch(94% 0.015 70)',
                boxShadow: 'var(--shadow-soft)',
              },
            },
            h(
              'div',
              {
                class: 'relative h-full w-full overflow-hidden rounded-sm',
              },
              [
                h('img', {
                  src: p.tile.src,
                  class: 'absolute inset-0 h-full w-full object-cover',
                  alt: 'Gallery photo',
                  loading: 'lazy'
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
                h('div', { class: 'absolute inset-x-2 bottom-2 h-2 rounded-full bg-white/50 backdrop-blur' }),
              ],
            ),
          ),
      )
  },
})
</script>

<template>
  <section
    ref="sectionRef"
    class="relative overflow-x-clip py-16 md:py-20 2xl:py-24 3xl:py-28 4xl:py-36"
  >
    <MarketingFloatingOrnaments :count="6" :hue-base="30" />

    <div class="container-page relative">
      <div class="mx-auto mb-8 max-w-2xl text-center md:mb-10 3xl:mb-14 4xl:mb-16">
        <motion.p
          :initial="{ opacity: 0, letterSpacing: '0.5em' }"
          :while-in-view="{ opacity: 1, letterSpacing: '0.3em' }"
          :viewport="{ once: true, amount: 0.5 }"
          :transition="{ duration: 1, ease: [0.16, 1, 0.3, 1] }"
          class="mb-3 text-xs uppercase text-(--color-primary)"
        >
          ⋄ ⋄ ⋄
        </motion.p>
        <h2 class="heading-display-lg text-balance">{{ t('gallery.title') }}</h2>
        <motion.p
          :initial="{ opacity: 0, y: 12 }"
          :while-in-view="{ opacity: 1, y: 0 }"
          :viewport="{ once: true, amount: 0.4 }"
          :transition="{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }"
          class="mt-4 text-(--color-muted-foreground)"
        >
          {{ t('gallery.subtitle') }}
        </motion.p>
      </div>

      <motion.div
        :style="{
          scale: reduce ? 1 : sceneScale,
          rotateX: reduce ? 0 : sceneRotateX,
          transformPerspective: 1400,
          transformStyle: 'preserve-3d',
          aspectRatio: '2.3 / 1',
        }"
        class="relative mx-auto max-w-5xl xl:max-w-6xl 2xl:max-w-[88rem] 3xl:max-w-[100rem] 4xl:max-w-[120rem]"
      >
        <ParallaxTile
          v-for="(tile, i) in TILES"
          :key="i"
          :index="i"
          :progress="scrollYProgress"
          :tile="tile"
          :reduce="reduce ?? false"
        />
      </motion.div>
    </div>
  </section>
</template>
