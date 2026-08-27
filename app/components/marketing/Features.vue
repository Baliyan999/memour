<script setup lang="ts">
import { motion, useReducedMotion } from 'motion-v'
import { computed } from 'vue'
import { useI18n } from '#imports'

/**
 * Features — "Что внутри". Asymmetric bento with 6 cards. Each carries
 * a small but recognisable mock of the actual feature UI (projector
 * slideshow, phone recording, voice bubble, swipe deck, geofence map,
 * Telegram chat). Hero card spans 2×2 on lg+, swipe card spans the
 * row width on tablet. No scroll-driven motion — entry is staggered
 * fade-up, hover lifts and brightens.
 */
const { t } = useI18n()
const reduce = useReducedMotion()

type CardKey = 'slideshow' | 'video' | 'voice' | 'swipe' | 'geofence' | 'telegram'

const ORDER: CardKey[] = ['slideshow', 'video', 'voice', 'swipe', 'geofence', 'telegram']
const META: Record<CardKey, { hue: number, span: string }> = {
  slideshow: { hue: 25, span: 'sm:col-span-2 lg:col-span-2 lg:row-span-2' },
  video: { hue: 55, span: '' },
  voice: { hue: 75, span: '' },
  swipe: { hue: 35, span: 'sm:col-span-2 lg:col-span-1' },
  geofence: { hue: 15, span: '' },
  telegram: { hue: 220, span: '' },
}

const cards = computed(() =>
  ORDER.map((key, i) => ({
    key,
    index: i,
    hue: META[key].hue,
    span: META[key].span,
    title: t(`features.f${i + 1}Title`),
    desc: t(`features.f${i + 1}Desc`),
  })),
)

const titleText = computed(() => t('features.title'))
const titleWords = computed(() => titleText.value.split(' '))
</script>

<template>
  <section
    id="features"
    class="relative overflow-hidden py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10"
  >
    <MarketingFloatingOrnaments :count="6" :hue-base="20" :hue-spread="70" />

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
        <h2 class="heading-display-lg text-balance">
          <motion.span
            v-for="(w, i) in titleWords"
            :key="i"
            :initial="{ opacity: 0, y: 30, filter: 'blur(10px)' }"
            :while-in-view="{ opacity: 1, y: 0, filter: 'blur(0px)' }"
            :viewport="{ once: true, amount: 0.4 }"
            :transition="{ duration: 0.85, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }"
            class="mr-[0.25em] inline-block"
          >
            {{ w }}
          </motion.span>
        </h2>
        <motion.p
          :initial="{ opacity: 0, y: 12 }"
          :while-in-view="{ opacity: 1, y: 0 }"
          :viewport="{ once: true, amount: 0.4 }"
          :transition="{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }"
          class="mt-4 text-pretty text-base text-(--color-muted-foreground) sm:text-lg"
        >
          {{ t('features.subtitle') }}
        </motion.p>
      </div>

      <!-- Layout:
           • Mobile (< sm): horizontal scroll-snap carousel so users
             swipe through the 6 features instead of scrolling through
             a long vertical strip. Each card takes ~82% of viewport
             width with the next card peeking on the right edge as a
             discoverability hint. Scrollbar hidden — swipes are the
             affordance.
           • sm+: original asymmetric bento with fixed row heights;
             hero card spans 2 cols × 2 rows on lg+. -->
      <ul class="mx-auto mt-6 flex max-w-6xl snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-6 -mx-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:m-0 sm:grid sm:auto-rows-[280px] sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:p-0 lg:auto-rows-[280px] lg:grid-cols-3 lg:gap-6 xl:max-w-[80rem] xl:auto-rows-[300px] 2xl:max-w-[92rem] 2xl:auto-rows-[320px] 2xl:gap-7 3xl:max-w-[108rem] 3xl:auto-rows-[360px] 3xl:gap-8 4xl:max-w-[128rem] 4xl:auto-rows-[400px] 4xl:gap-10">
        <motion.li
          v-for="card in cards"
          :key="card.key"
          :initial="reduce ? { opacity: 1 } : { opacity: 0, y: 24 }"
          :while-in-view="reduce ? { opacity: 1 } : { opacity: 1, y: 0 }"
          :viewport="{ once: true, amount: 0.15 }"
          :transition="{ duration: 0.7, delay: reduce ? 0 : card.index * 0.07, ease: [0.16, 1, 0.3, 1] }"
          class="group relative isolate flex h-[520px] w-[82%] shrink-0 snap-center flex-col overflow-hidden rounded-(--radius-xl) border border-(--color-border)/60 bg-white/80 backdrop-blur-sm transition-[border-color] duration-500 hover:border-(--color-primary)/40 sm:h-auto sm:w-auto sm:shrink" :class="[
            card.span,
          ]"
          :style="{ boxShadow: 'var(--shadow-soft)' }"
        >
          <!-- Hue wash background -->
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-0 -z-10 opacity-60 transition-opacity duration-500 group-hover:opacity-100"
            :style="{
              background: `radial-gradient(120% 80% at 0% 0%, oklch(95% 0.07 ${card.hue} / 0.55), transparent 60%)`,
            }"
          />

          <!-- Mockup stage:
               • Mobile carousel: stage gets a FIXED height (260px) and
                 the text block stretches with flex-1. Without this,
                 each card's stage was flex-1 (filling whatever was
                 left after the text block) — and since text blocks
                 had variable height, mockups+text started at different
                 Y across cards. Fixed stage height aligns the text
                 baselines exactly.
               • sm+: percentage-based proportion (55%+) of the bento
                 cell. Stage is flex-1 again so it adapts to row height. -->
          <div class="relative h-[220px] shrink-0 overflow-hidden sm:h-auto sm:flex-1 sm:min-h-[42%] lg:min-h-[46%]">
            <MarketingMockup :card-key="card.key" :hue="card.hue" :is-hero="card.key === 'slideshow'" />
          </div>

          <!-- Text block — flex-1 so it fills the remaining card height
               after the fixed mockup stage, keeping all cards' visible
               heights identical in the carousel. -->
          <div
            class="relative flex-1 border-t border-(--color-border)/60 bg-white/70 backdrop-blur-sm" :class="[
              card.key === 'slideshow' ? 'p-6 sm:p-7' : 'p-5 sm:p-6',
            ]"
          >
            <div class="mb-2 flex items-center gap-3">
              <span
                aria-hidden="true"
                class="block h-[2px] w-7 transition-[width] duration-500 group-hover:w-12"
                :style="{ background: `oklch(70% 0.13 ${card.hue})` }"
              />
              <span
                aria-hidden="true"
                class="text-[10px] uppercase tracking-[0.2em] text-(--color-muted-foreground)/80"
              >{{ String(card.index + 1).padStart(2, '0') }}</span>
            </div>
            <h3
              :class="
                card.key === 'slideshow'
                  ? 'text-2xl text-(--color-foreground) sm:text-3xl 3xl:text-4xl 4xl:text-5xl'
                  : 'text-lg text-(--color-foreground) sm:text-xl 3xl:text-2xl 4xl:text-3xl'
              "
            >
              {{ card.title }}
            </h3>
            <p
              class="mt-1.5 text-pretty leading-relaxed text-(--color-muted-foreground)" :class="[
                card.key === 'slideshow'
                  ? 'text-sm sm:text-base 3xl:text-lg 4xl:text-xl'
                  : 'text-[13px] sm:text-sm 3xl:text-base 4xl:text-lg',
              ]"
            >
              {{ card.desc }}
            </p>
          </div>
        </motion.li>
      </ul>
    </div>
  </section>
</template>
