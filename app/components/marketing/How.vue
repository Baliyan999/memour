<script setup lang="ts">
import { ref, computed, defineComponent, h, type PropType } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'motion-v'
import { QrCode, Camera, Heart } from '@lucide/vue'

/**
 * How — vertical timeline with 3 steps. As the user scrolls past the
 * section, an animated gradient line fills the rail and a diamond
 * marker travels down it. Each step "lights up" (scale + halo +
 * pulse ring + icon bounce) when scrollYProgress passes its
 * activation threshold.
 */
const { t } = useI18n()
const reduce = useReducedMotion()

const ICONS = [QrCode, Camera, Heart] as const
const STEP_ACTIVATIONS = [0.18, 0.5, 0.82] as const

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start 80%', 'end 30%'],
})

const lineHeight = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
const cometTop = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
const cometOpacity = useTransform(scrollYProgress, [0, 0.05, 0.95, 1], [0, 1, 1, 0])
// titleY parallax removed — at anchor jump (scrollYProgress=0) the
// title used to sit 25% below natural, leaving a dead band above.
// Now it stays at natural Y so the section reads tight when anchored.

const StepBadge = defineComponent({
  props: {
    Icon: { type: Function as PropType<typeof QrCode>, required: true },
    number: { type: Number, required: true },
    activation: { type: Number, required: true },
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    reduce: { type: Boolean, required: true },
  },
  setup(p) {
    const lit = useTransform(p.progress, [p.activation - 0.12, p.activation + 0.06], [0, 1])
    const scale = useTransform(lit, [0, 1], [1, 1.08])
    const haloOpacity = useTransform(lit, [0, 1], [0, 0.8])
    const ringOpacity = useTransform(lit, [0, 0.5, 1], [0, 0.7, 0])
    const ringScale = useTransform(lit, [0, 1], [0.6, 1.6])
    const iconScale = useTransform(lit, [0, 0.5, 1], [1, 1.3, 1.05])
    const iconRotate = useTransform(lit, [0, 0.5, 1], [0, -12, 0])
    const bubbleScale = useTransform(lit, [0, 0.6, 1], [1, 1.18, 1.1])

    return () =>
      h(
        motion.div,
        {
          whileHover: { rotate: -3 },
          transition: { type: 'spring', stiffness: 280, damping: 18 },
          style: {
            scale: p.reduce ? 1 : scale,
            transform: 'translateZ(50px)',
          },
          class:
            'relative grid h-16 w-16 place-items-center rounded-full bg-white shadow-(--shadow-soft) sm:h-20 sm:w-20 3xl:h-28 3xl:w-28 4xl:h-32 4xl:w-32',
        },
        () => [
          !p.reduce
            ? h(motion.span, {
                style: { opacity: haloOpacity },
                'aria-hidden': true,
                class:
                  'pointer-events-none absolute inset-0 -m-4 rounded-full bg-(--color-primary)/30 blur-xl',
              })
            : null,
          !p.reduce
            ? h(motion.span, {
                style: { opacity: ringOpacity, scale: ringScale },
                'aria-hidden': true,
                class:
                  'pointer-events-none absolute inset-0 rounded-full border-2 border-(--color-primary)',
              })
            : null,
          h('span', {
            'aria-hidden': true,
            class: 'pointer-events-none absolute inset-0 rounded-full',
            style: { border: '1px solid oklch(92% 0.015 70)' },
          }),
          h(
            motion.div,
            {
              style: p.reduce ? undefined : { scale: iconScale, rotate: iconRotate },
              class: 'relative',
            },
            () => h(p.Icon, { class: 'h-6 w-6 text-(--color-primary) sm:h-7 sm:w-7 3xl:h-10 3xl:w-10 4xl:h-12 4xl:w-12', strokeWidth: 1.5 }),
          ),
          h(
            motion.span,
            {
              style: { scale: p.reduce ? 1 : bubbleScale },
              class:
                'absolute -right-1 -top-1 z-10 grid h-6 w-6 place-items-center rounded-full bg-(--color-primary) text-[11px] font-semibold text-(--color-primary-foreground) shadow-(--shadow-soft) sm:h-7 sm:w-7 sm:text-xs 3xl:h-9 3xl:w-9 3xl:text-sm 4xl:h-10 4xl:w-10 4xl:text-base',
            },
            () => p.number,
          ),
        ],
      )
  },
})

const TitleReveal = defineComponent({
  props: { text: { type: String, required: true } },
  setup(p) {
    const words = p.text.split(' ')
    return () =>
      h(
        'h2',
        { class: 'heading-display-lg text-balance' },
        words.map((w, i) =>
          h(
            motion.span,
            {
              key: i,
              initial: { opacity: 0, y: 30, filter: 'blur(10px)' },
              whileInView: { opacity: 1, y: 0, filter: 'blur(0px)' },
              viewport: { once: true, amount: 0.4 },
              transition: { duration: 0.85, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] },
              class: 'mr-[0.25em] inline-block',
            },
            () => w,
          ),
        ),
      )
  },
})

const titleText = computed(() => t('how.title'))
const steps = computed(() =>
  [1, 2, 3].map((i, idx) => ({
    number: i,
    Icon: ICONS[idx],
    title: t(`how.step${i}Title`),
    desc: t(`how.step${i}Desc`),
    activation: STEP_ACTIVATIONS[idx],
    index: idx,
  })),
)
</script>

<template>
  <section
    id="how"
    ref="sectionRef"
    class="relative overflow-hidden py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10"
  >
    <MarketingFloatingOrnaments :count="10" :hue-base="25" :hue-spread="70" />

    <div class="container-page relative">
      <div class="mx-auto mb-6 max-w-2xl text-center md:mb-8 3xl:mb-10 4xl:mb-14">
        <motion.p
          :initial="{ opacity: 0, letterSpacing: '0.5em' }"
          :while-in-view="{ opacity: 1, letterSpacing: '0.3em' }"
          :viewport="{ once: true, amount: 0.5 }"
          :transition="{ duration: 1, ease: [0.16, 1, 0.3, 1] }"
          class="mb-3 text-[10px] uppercase text-(--color-primary) sm:text-xs"
        >
          ⋄ ⋄ ⋄
        </motion.p>
        <TitleReveal :text="titleText" />
      </div>

      <div class="relative mx-auto max-w-4xl xl:max-w-5xl 2xl:max-w-6xl 3xl:max-w-[88rem] 4xl:max-w-[100rem]">
        <!-- Vertical timeline: static rail + animated gradient line + diamond marker -->
        <div class="absolute left-[31px] top-2 hidden h-full w-[2px] bg-(--color-border)/60 sm:left-[39px] md:block 3xl:left-[55px] 4xl:left-[63px]">
          <motion.div
            :style="{ height: lineHeight }"
            class="w-full origin-top bg-gradient-to-b from-(--color-primary) via-(--color-rose) to-(--color-champagne)"
          />
          <motion.div
            v-if="!reduce"
            :style="{ top: cometTop, opacity: cometOpacity }"
            aria-hidden="true"
            class="absolute left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
          >
            <span class="block h-2.5 w-2.5 rotate-45 border border-(--color-primary) bg-white shadow-(--shadow-soft)" />
          </motion.div>
        </div>

        <ol class="flex flex-col gap-7 md:gap-9 2xl:gap-12 3xl:gap-14 4xl:gap-16">
          <li v-for="step in steps" :key="step.number">
            <motion.div
              :initial="reduce ? { opacity: 1 } : { opacity: 0, x: step.index % 2 === 1 ? 60 : -60, scale: 0.92 }"
              :while-in-view="reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }"
              :viewport="{ once: true, amount: 0.05, margin: '0px 0px -5% 0px' }"
              :transition="{ duration: 0.8, delay: reduce ? 0 : step.index * 0.12, ease: [0.16, 1, 0.3, 1] }"
            >
              <div class="group grid grid-cols-[64px_1fr] items-start gap-4 sm:grid-cols-[80px_1fr] sm:gap-6 3xl:grid-cols-[112px_1fr] 3xl:gap-10 4xl:grid-cols-[128px_1fr] 4xl:gap-12">
                <StepBadge
                  :Icon="step.Icon"
                  :number="step.number"
                  :activation="step.activation"
                  :progress="scrollYProgress"
                  :reduce="reduce ?? false"
                />
                <div class="pt-1 sm:pt-2" :style="{ transform: 'translateZ(30px)' }">
                  <h3 class="mb-2 heading-display-md transition-transform duration-500 group-hover:translate-x-1">
                    {{ step.title }}
                  </h3>
                  <p class="max-w-xl text-pretty text-(--color-muted-foreground) transition-colors duration-500 group-hover:text-(--color-foreground) 3xl:max-w-2xl 3xl:text-lg 4xl:max-w-3xl 4xl:text-xl">
                    {{ step.desc }}
                  </p>
                </div>
              </div>
            </motion.div>
          </li>
        </ol>
      </div>
    </div>
  </section>
</template>
