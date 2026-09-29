<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { motion, useScroll, useTransform } from 'motion-v'
import { ArrowRight } from '@lucide/vue'
import { usePrefersReducedMotion } from '~/composables/useMotion'
// MarketingOrnaments auto-imported by Nuxt

/**
 * HeroSection — top-of-page hero. Mirrors the Next.js version:
 *   • Title word-by-word stagger entrance
 *   • Accent word in italic --color-primary
 *   • Decorative ⋄ separator over subtitle
 *   • Two CTA buttons (primary + secondary)
 *   • Feature bullets in 2-col grid
 *   • Big interlocked rings ornament centred behind the title,
 *     with scroll-driven Y translate
 *
 * The entrance is CSS (`animate-rise-in` + --enter-delay), so the
 * hero paints with the first frame instead of waiting for hydration;
 * JS only drives the scroll-linked parallax afterwards.
 */

const { t } = useI18n()
const reduce = usePrefersReducedMotion()

// Section element ref drives the scroll-linked transforms.
const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start start', 'end start'],
})

const titleY = useTransform(scrollYProgress, [0, 1], ['0%', '-12%'])
const titleScale = useTransform(scrollYProgress, [0, 1], [1, 0.92])
const titleOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])
const ringsY = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
const ringsRotate = useTransform(scrollYProgress, [0, 1], [0, 12])

const titleWords = computed(() => t('hero.title').split(' '))
// Accent word comes from i18n — a positional guess landed on «со» in ru.
const accentIndex = computed(() => titleWords.value.indexOf(t('hero.titleAccent')))

// Entrance timeline (ms): words ripple in, and the rest of the hero
// follows while the last words are still settling — overlapping, so the
// subtitle (the LCP element) paints ~0.25 s after first paint, not ~0.5 s.
const WORD_DELAY = 40
const WORD_STEP = 45
const enterAfterTitle = computed(() => WORD_DELAY + Math.min(titleWords.value.length, 4) * WORD_STEP)
</script>

<template>
  <section
    ref="sectionRef"
    class="relative isolate overflow-hidden pt-[calc(env(safe-area-inset-top,0)+5.5rem)] md:pt-20 3xl:pt-24 4xl:pt-28"
  >
    <motion.div
      :style="{
        y: reduce ? 0 : titleY,
        scale: reduce ? 1 : titleScale,
        opacity: reduce ? 1 : titleOpacity,
      }"
      class="container-page relative pb-12 pt-6 md:pb-16 md:pt-10 3xl:pb-20 3xl:pt-14 4xl:pb-24 4xl:pt-20 motion-reduce:transform-none! motion-reduce:opacity-100! [@media(max-height:30rem)]:pb-8!"
    >
      <div class="mx-auto max-w-4xl text-center xl:max-w-5xl 2xl:max-w-6xl 3xl:max-w-[88rem] 4xl:max-w-[100rem]">
        <div class="relative">
          <!-- Rings ornament — centred behind the title (on every width,
               however tall the hero), slow Y parallax; it leaves with
               the title, so it never drifts under the fading buttons. -->
          <motion.div
            aria-hidden="true"
            :style="{
              y: reduce ? 0 : ringsY,
              rotate: reduce ? 0 : ringsRotate,
              '--enter-delay': '300ms',
            }"
            class="animate-fade-in pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2 opacity-50 motion-reduce:transform-none!"
          >
            <!-- Float lives on the inner box: a CSS animation on the motion
                 element would override its scroll-linked transform. The
                 rings fill the box (2:1, as drawn), so its centre is theirs. -->
            <div
              class="animate-float"
              :style="{
                width: 'clamp(220px, 17.5vw, 440px)',
                aspectRatio: '2 / 1',
              }"
            >
              <MarketingOrnaments kind="rings" size="100%" class="block h-full w-full" />
            </div>
          </motion.div>

          <!-- Real spaces between the word boxes: screen readers, search
               engines and copy-paste read words, not one glued string.
               A no-break space in the copy keeps two words in one box,
               so the balanced wrap can't split them (ru «не потеряется»). -->
          <h1 class="heading-display-xl text-balance">
            <template v-for="(w, i) in titleWords" :key="i">
              <span
                class="animate-rise-in inline-block"
                :class="i === accentIndex && 'italic font-medium text-(--color-primary)'"
                :style="{ '--enter-delay': `${WORD_DELAY + i * WORD_STEP}ms`, '--rise': '0.28em' }"
              >{{ w }}</span>{{ i < titleWords.length - 1 ? ' ' : '' }}
            </template>
          </h1>
        </div>

        <div
          class="animate-rise-in mx-auto mt-5 flex max-w-2xl items-center justify-center md:mt-6"
          :style="{ '--enter-delay': `${enterAfterTitle}ms`, '--rise': '0px' }"
        >
          <span class="h-px flex-1 bg-(--color-border)" />
          <span class="px-4 text-xs uppercase tracking-[0.3em] text-(--color-muted-foreground)">
            {{ t('hero.eyebrow') }}
          </span>
          <span class="h-px flex-1 bg-(--color-border)" />
        </div>

        <p
          class="animate-rise-in mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-(--color-muted-foreground) sm:text-lg md:mt-6 md:text-xl xl:max-w-3xl 2xl:max-w-4xl 2xl:text-2xl 3xl:max-w-5xl 3xl:text-3xl 4xl:max-w-6xl 4xl:text-[2.25rem]"
          :style="{ '--enter-delay': `${enterAfterTitle + 60}ms`, '--rise': '12px' }"
        >
          {{ t('hero.subtitle') }}
        </p>

        <div
          class="animate-rise-in mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-4 md:mt-9"
          :style="{ '--enter-delay': `${enterAfterTitle + 140}ms`, '--rise': '12px' }"
        >
          <a
            href="#lead"
            class="press group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-md bg-(--color-primary) px-7 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90 sm:w-auto"
          >
            <span class="relative z-10 flex items-center justify-center gap-2">
              {{ t('hero.ctaPrimary') }}
              <ArrowRight class="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </span>
            <span class="absolute inset-0 -z-0 bg-gradient-to-r from-(--color-primary) via-(--color-rose) to-(--color-primary) bg-[length:200%_100%] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-hover:[animation:shimmer_2.4s_linear_infinite]" />
          </a>
          <a
            href="#how"
            class="press inline-flex h-12 w-full items-center justify-center rounded-md border border-(--color-border) bg-white/70 px-7 text-base font-medium backdrop-blur hover:bg-(--color-muted) sm:w-auto"
          >
            {{ t('hero.ctaSecondary') }}
          </a>
        </div>

        <ul
          class="mx-auto mt-10 grid max-w-3xl gap-x-6 gap-y-3 text-left text-sm text-(--color-muted-foreground) sm:grid-cols-2 md:mt-12 xl:max-w-4xl xl:text-base 2xl:max-w-5xl 2xl:gap-x-10 2xl:gap-y-4 2xl:text-lg 3xl:mt-14 3xl:max-w-6xl 3xl:text-xl 4xl:mt-16 4xl:max-w-[88rem] 4xl:text-2xl"
        >
          <li
            v-for="i in 4"
            :key="i"
            class="animate-rise-in flex items-center gap-3"
            :style="{ '--enter-delay': `${enterAfterTitle + 220 + i * 50}ms`, '--rise': '10px' }"
          >
            <span aria-hidden="true" class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-(--color-accent)/60 text-(--color-primary)">
              ✓
            </span>
            <span>{{ t(`hero.bullet${i}`) }}</span>
          </li>
        </ul>
      </div>
    </motion.div>
  </section>
</template>
