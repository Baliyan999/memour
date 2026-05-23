<script setup lang="ts">
import { ref, computed, defineComponent, h, type PropType } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform, useReducedMotion, easeInOut, type MotionValue } from 'motion-v'

/**
 * StickyHeadline — three short phrases that crossfade as the user
 * scrolls past a pinned section. Each phrase pairs a TEXT layer with
 * a VISUAL layer (single photo, fanned cards, photo grid). First
 * phrase has no enter, last has no exit so the section never shows
 * a blank pinned area. Pin window = 220vh.
 */
const { t } = useI18n()
const reduce = useReducedMotion()

type Visual = 'single' | 'fan' | 'grid'
const PHRASE_VISUALS: Visual[] = ['single', 'fan', 'grid']

const phrases = computed(() =>
  PHRASE_VISUALS.map((visual, i) => ({
    before: t(`stickyHeadline.phrase${i + 1}Before`),
    accent: t(`stickyHeadline.phrase${i + 1}Accent`),
    after: t(`stickyHeadline.phrase${i + 1}After`),
    visual,
  })),
)

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start start', 'start -220%'],
})

// Reusable photo card. Inline so we don't pollute the component tree.
const PhotoCard = defineComponent({
  props: {
    hue: { type: Number, required: true },
    rotate: { type: Number, default: 0 },
    intensity: { type: Number, default: 0.08 },
    cls: { type: String, default: '' },
  },
  setup(p) {
    return () =>
      h('div', {
        class: `relative rounded-2xl bg-white p-2 shadow-(--shadow-soft) ${p.cls}`,
        style: p.rotate ? { transform: `rotate(${p.rotate}deg)` } : undefined,
      }, [
        h('div', {
          class: 'h-full w-full rounded-xl',
          style: {
            background: `linear-gradient(135deg,
              oklch(85% ${p.intensity} ${p.hue}) 0%,
              oklch(92% ${p.intensity * 0.7} ${p.hue + 25}) 55%,
              oklch(80% ${p.intensity * 1.3} ${p.hue - 10}) 100%)`,
          },
        }),
      ])
  },
})

// Single phrase layer with its motion-driven opacity + y.
const PhraseLayer = defineComponent({
  props: {
    index: { type: Number, required: true },
    total: { type: Number, required: true },
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    reduce: { type: Boolean, required: true },
    phrase: {
      type: Object as PropType<{ before: string; accent: string; after: string; visual: Visual }>,
      required: true,
    },
  },
  setup(p) {
    const span = 1 / p.total
    const start = p.index * span
    const end = start + span
    const isFirst = p.index === 0
    const isLast = p.index === p.total - 1
    const ENTER = span * 0.3
    const EXIT = span * 0.3
    const inputs = isFirst
      ? [end - EXIT, end]
      : isLast
        ? [start, start + ENTER]
        : [start, start + ENTER, end - EXIT, end]

    const opacityValues = isFirst ? [1, 0] : isLast ? [0, 1] : [0, 1, 1, 0]
    const yValues = isFirst ? [0, -24] : isLast ? [24, 0] : [24, 0, 0, -24]

    const opacity = useTransform(p.progress, inputs as any, opacityValues, { ease: easeInOut })
    const y = useTransform(p.progress, inputs as any, yValues, { ease: easeInOut })

    return () =>
      h(
        motion.div,
        {
          style: {
            opacity: p.reduce ? (p.index === 1 ? 1 : 0) : opacity,
            y: p.reduce ? 0 : y,
          },
          class:
            'absolute inset-0 flex flex-col items-center justify-center gap-8 md:gap-12 pt-20 3xl:gap-16 3xl:pt-28 4xl:gap-20 4xl:pt-36',
        },
        () => [
          h('h2', { class: 'heading-display-xl px-4 text-center' }, [
            h('span', { class: 'text-(--color-foreground)' }, p.phrase.before),
            ' ',
            h('span', { class: 'italic font-medium text-(--color-primary)' }, p.phrase.accent),
            p.phrase.after
              ? [' ', h('span', { class: 'text-(--color-foreground)' }, p.phrase.after)]
              : null,
          ]),
          renderVisual(p.phrase.visual),
        ],
      )
  },
})

function renderVisual(variant: Visual) {
  if (variant === 'single') {
    return h(
      'div',
      { class: 'relative' },
      h(PhotoCard, {
        hue: 30,
        rotate: -3,
        intensity: 0.1,
        cls: 'h-64 w-52 md:h-80 md:w-64 lg:h-[22rem] lg:w-72 xl:h-[24rem] xl:w-80 2xl:h-[28rem] 2xl:w-96 3xl:h-[34rem] 3xl:w-[28rem] 4xl:h-[40rem] 4xl:w-[32rem]',
      }),
    )
  }
  if (variant === 'fan') {
    const cards = [
      { hue: 15, rot: -18, x: -2.2, z: 1, size: 'h-32 w-24 sm:h-44 sm:w-32 md:h-56 md:w-40 lg:h-60 lg:w-44 xl:h-64 xl:w-48 2xl:h-72 2xl:w-52 3xl:h-80 3xl:w-60 4xl:h-96 4xl:w-72', intensity: 0.08 },
      { hue: 40, rot: -9, x: -1.05, z: 2, size: 'h-36 w-28 sm:h-48 sm:w-36 md:h-60 md:w-44 lg:h-64 lg:w-48 xl:h-72 xl:w-52 2xl:h-80 2xl:w-56 3xl:h-[22rem] 3xl:w-64 4xl:h-[26rem] 4xl:w-80', intensity: 0.08 },
      { hue: 60, rot: 0, x: 0, z: 3, size: 'h-40 w-32 sm:h-52 sm:w-40 md:h-64 md:w-48 lg:h-72 lg:w-52 xl:h-80 xl:w-60 2xl:h-[22rem] 2xl:w-64 3xl:h-[26rem] 3xl:w-72 4xl:h-[30rem] 4xl:w-[22rem]', intensity: 0.1 },
      { hue: 80, rot: 9, x: 1.05, z: 2, size: 'h-36 w-28 sm:h-48 sm:w-36 md:h-60 md:w-44 lg:h-64 lg:w-48 xl:h-72 xl:w-52 2xl:h-80 2xl:w-56 3xl:h-[22rem] 3xl:w-64 4xl:h-[26rem] 4xl:w-80', intensity: 0.08 },
      { hue: 100, rot: 18, x: 2.2, z: 1, size: 'h-32 w-24 sm:h-44 sm:w-32 md:h-56 md:w-40 lg:h-60 lg:w-44 xl:h-64 xl:w-48 2xl:h-72 2xl:w-52 3xl:h-80 3xl:w-60 4xl:h-96 4xl:w-72', intensity: 0.08 },
    ]
    return h(
      'div',
      { class: 'relative h-40 w-full max-w-[420px] sm:h-52 md:h-64 md:max-w-[560px] lg:h-72 lg:max-w-[640px] xl:h-80 xl:max-w-[760px] 2xl:h-[22rem] 2xl:max-w-[880px] 3xl:h-[26rem] 3xl:max-w-[1040px] 4xl:h-[30rem] 4xl:max-w-[1280px]' },
      cards.map((c, i) =>
        h(
          'div',
          {
            key: i,
            class: 'absolute left-1/2 top-0',
            style: {
              transform: `translateX(calc(-50% + ${c.x * 42}px))`,
              zIndex: c.z,
            },
          },
          h(PhotoCard, { hue: c.hue, rotate: c.rot, cls: c.size, intensity: c.intensity }),
        ),
      ),
    )
  }
  // grid — on mobile show 8 cards in a 4×2 layout (larger tiles, less
  // visual density). From sm+ switch to the original 6×2 layout with
  // 12 cards by revealing the trailing 4 hidden cards.
  const tiles = Array.from({ length: 12 }, (_, i) => ({
    hue: 10 + ((i * 23) % 80),
    rotate: ((i % 4) - 1.5) * 2.5,
  }))
  return h(
    'div',
    { class: 'grid w-full max-w-[320px] grid-cols-4 gap-2 sm:max-w-[380px] sm:grid-cols-6 sm:gap-2 md:max-w-[560px] md:gap-3 lg:max-w-[640px] xl:max-w-[760px] xl:gap-3.5 2xl:max-w-[880px] 2xl:gap-4 3xl:max-w-[1040px] 3xl:gap-5 4xl:max-w-[1280px] 4xl:gap-6' },
    tiles.map((c, i) =>
      h(PhotoCard, {
        key: i,
        hue: c.hue,
        rotate: c.rotate,
        cls: i >= 8 ? 'aspect-[3/4] hidden sm:block' : 'aspect-[3/4]',
      }),
    ),
  )
}
</script>

<template>
  <section ref="sectionRef" class="relative" :style="{ height: '320vh' }">
    <div class="sticky top-0 h-screen overflow-x-clip">
      <MarketingFloatingOrnaments :count="14" :hue-base="25" :hue-spread="70" />
      <div class="container-page relative h-full">
        <PhraseLayer
          v-for="(p, i) in phrases"
          :key="i"
          :index="i"
          :total="phrases.length"
          :progress="scrollYProgress"
          :reduce="reduce ?? false"
          :phrase="p"
        />
      </div>
    </div>
  </section>
</template>
