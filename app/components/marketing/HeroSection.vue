<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform, useReducedMotion } from 'motion-v'
import { ArrowRight } from '@lucide/vue'
// MarketingOrnaments auto-imported by Nuxt

/**
 * HeroSection — top-of-page hero. Mirrors the Next.js version:
 *   • Title word-by-word stagger entrance
 *   • Accent word in italic --color-primary
 *   • Decorative ⋄ separator over subtitle
 *   • Two CTA buttons (primary + secondary)
 *   • Feature bullets in 2-col grid
 *   • Big interlocked rings ornament centered behind the title,
 *     with scroll-driven Y translate
 */

const { t } = useI18n()
const reduce = useReducedMotion()

// Section element ref drives the scroll-linked transforms.
const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start start', 'end start'],
})

const titleY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%'])
const titleScale = useTransform(scrollYProgress, [0, 1], [1, 0.92])
const titleOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
const ringsY = useTransform(scrollYProgress, [0, 1], ['0%', '75%'])
const ringsRotate = useTransform(scrollYProgress, [0, 1], [0, 12])

const titleWords = computed(() => t('hero.title').split(' '))
const accentIndex = computed(() => Math.floor(titleWords.value.length / 2))
</script>

<template>
  <section
    ref="sectionRef"
    class="relative isolate overflow-hidden pt-[calc(env(safe-area-inset-top,0)+5.5rem)] md:pt-20 3xl:pt-24 4xl:pt-28"
  >
    <!-- Rings ornament — centered behind the title, slow Y parallax -->
    <motion.div
      aria-hidden="true"
      :initial="{ opacity: 0, scale: 0.85 }"
      :animate="{ opacity: 0.5, scale: 1 }"
      :transition="{ duration: 1.2, delay: 0.6 }"
      :style="{
        y: reduce ? 0 : ringsY,
        rotate: reduce ? 0 : ringsRotate,
      }"
      class="pointer-events-none absolute left-1/2 top-[44%] -z-10 -translate-x-1/2 animate-float"
    >
      <div
        :style="{
          width: 'clamp(440px, 35vw, 880px)',
          aspectRatio: '2 / 1',
        }"
      >
        <MarketingOrnaments kind="rings" size="100%" />
      </div>
    </motion.div>

    <motion.div
      :style="{
        y: reduce ? 0 : titleY,
        scale: reduce ? 1 : titleScale,
        opacity: reduce ? 1 : titleOpacity,
      }"
      class="container-page relative pb-12 pt-6 md:pb-16 md:pt-10 3xl:pb-20 3xl:pt-14 4xl:pb-24 4xl:pt-20"
    >
      <div class="mx-auto max-w-4xl text-center xl:max-w-5xl 2xl:max-w-6xl 3xl:max-w-[88rem] 4xl:max-w-[100rem]">
        <h1 class="heading-display-xl text-balance">
          <motion.span
            v-for="(w, i) in titleWords"
            :key="i"
            :custom="i"
            :initial="{ opacity: 0, y: 40, filter: 'blur(10px)' }"
            :animate="{ opacity: 1, y: 0, filter: 'blur(0px)' }"
            :transition="{
              duration: 0.9,
              delay: 0.15 + i * 0.08,
              ease: [0.16, 1, 0.3, 1],
            }"
            class="mr-[0.25em] inline-block"
          >
            <span
              v-if="i === accentIndex"
              class="italic font-medium text-(--color-primary)"
            >{{ w }}</span>
            <template v-else>{{ w }}</template>
          </motion.span>
        </h1>

        <motion.div
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :transition="{ duration: 0.6, delay: 0.9 }"
          class="mx-auto mt-5 flex max-w-2xl items-center justify-center md:mt-6"
        >
          <span class="h-px flex-1 bg-(--color-border)" />
          <span class="px-4 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
            {{ t('hero.eyebrow') }}
          </span>
          <span class="h-px flex-1 bg-(--color-border)" />
        </motion.div>

        <motion.p
          :initial="{ opacity: 0, y: 14 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.8, delay: 1.05 }"
          class="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-(--color-muted-foreground) sm:text-lg md:mt-6 md:text-xl xl:max-w-3xl 2xl:max-w-4xl 2xl:text-2xl 3xl:max-w-5xl 3xl:text-3xl 4xl:max-w-6xl 4xl:text-[2.25rem]"
        >
          {{ t('hero.subtitle') }}
        </motion.p>

        <motion.div
          :initial="{ opacity: 0, y: 14 }"
          :animate="{ opacity: 1, y: 0 }"
          :transition="{ duration: 0.8, delay: 1.2 }"
          class="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4 md:mt-9"
        >
          <a
            href="#lead"
            class="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-90 sm:w-auto"
          >
            <span class="relative z-10 flex items-center justify-center gap-2">
              {{ t('hero.ctaPrimary') }}
              <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
            <span class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]" />
          </a>
          <a
            href="#how"
            class="inline-flex h-12 w-full items-center justify-center rounded-md border border-(--color-border) bg-white/70 px-7 text-base font-medium backdrop-blur transition-colors hover:bg-(--color-muted) sm:w-auto"
          >
            {{ t('hero.ctaSecondary') }}
          </a>
        </motion.div>

        <motion.ul
          :initial="'hidden'"
          :animate="'visible'"
          :variants="{
            hidden: {},
            visible: { transition: { delayChildren: 1.5, staggerChildren: 0.12 } },
          }"
          class="mx-auto mt-10 grid max-w-3xl gap-x-6 gap-y-3 text-left text-sm text-(--color-muted-foreground) sm:grid-cols-2 md:mt-12 xl:max-w-4xl xl:text-base 2xl:max-w-5xl 2xl:gap-x-10 2xl:gap-y-4 2xl:text-lg 3xl:mt-14 3xl:max-w-6xl 3xl:text-xl 4xl:mt-16 4xl:max-w-[88rem] 4xl:text-2xl"
        >
          <motion.li
            v-for="i in 4"
            :key="i"
            :variants="{
              hidden: { opacity: 0, x: -16 },
              visible: {
                opacity: 1,
                x: 0,
                transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
              },
            }"
            class="flex items-center gap-3"
          >
            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-(--color-accent)/60 text-(--color-primary)">
              ✓
            </span>
            <span>{{ t(`hero.bullet${i}`) }}</span>
          </motion.li>
        </motion.ul>
      </div>
    </motion.div>
  </section>
</template>
