<script setup lang="ts">
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion-v'
import { ref } from 'vue'
import { useI18n } from '#imports'

/**
 * Stats — honest product-promise numbers (NOT adoption metrics) on a
 * surface card that arcs across the viewport on scroll. Each item
 * has a localized prefix/suffix; in Russian the prefix "до" sits in
 * the big display, in Uzbek the suffix "tagacha"/"soniyalik"/"oygacha"
 * gets its own step-down display line so it doesn't get clipped at
 * 2K/4K.
 */
const { t } = useI18n()
const reduce = useReducedMotion()

const ITEM_VALUES = [
  { value: 30, suffixKey: 'statsPromo.suffix1', labelKey: 'statsPromo.label1' },
  { value: 15, suffixKey: 'statsPromo.suffix2', labelKey: 'statsPromo.label2' },
  { value: 6, suffixKey: 'statsPromo.suffix3', labelKey: 'statsPromo.label3' },
] as const

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start 75%', 'end 25%'],
})

// Ballistic arc: card flies in lower-left, lingers center, drifts out upper-right.
const xRaw = useTransform(
  scrollYProgress,
  [0, 0.4, 0.6, 1],
  ['-130%', '0%', '0%', '140%'],
)
const x = useSpring(xRaw, { stiffness: 120, damping: 26, mass: 0.6 })
const rotate = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [-6, 0, 0, 9])
const y = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [50, 0, 0, -90])
const opacity = useTransform(scrollYProgress, [0, 0.15, 0.85, 1], [0, 1, 1, 0])
const scale = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [0.9, 1, 1, 0.82])
</script>

<template>
  <section ref="sectionRef" class="relative overflow-x-clip py-8 md:py-12">
    <MarketingFloatingOrnaments :count="10" />

    <div class="container-page relative">
      <motion.div
        :style="reduce ? {} : { x, rotate, opacity, scale, y }"
        class="mx-auto max-w-3xl will-change-transform xl:max-w-4xl 2xl:max-w-5xl 3xl:max-w-6xl 4xl:max-w-[88rem]"
      >
        <div
          class="surface-card relative overflow-hidden rounded-(--radius-xl) p-7 sm:p-10 md:p-14 3xl:p-16 4xl:p-20"
        >
          <div
            aria-hidden="true"
            class="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-(--color-champagne)/50 blur-3xl"
          />
          <div
            aria-hidden="true"
            class="pointer-events-none absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-(--color-rose)/40 blur-3xl"
          />

          <div class="relative grid gap-8 sm:gap-10 md:grid-cols-3 md:items-stretch 3xl:gap-14 4xl:gap-20">
            <div
              v-for="item in ITEM_VALUES"
              :key="item.labelKey"
              class="flex h-full flex-col text-center md:text-left"
            >
              <MarketingCounter
                :prefix="t('statsPromo.prefix')"
                :to="item.value"
                :suffix="t(item.suffixKey)"
              />
              <p class="mt-auto pt-4 text-sm text-(--color-muted-foreground) 3xl:text-base 4xl:text-lg">
                {{ t(item.labelKey) }}
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  </section>
</template>
