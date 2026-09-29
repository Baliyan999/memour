<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '#imports'
import { useReveal } from '~/composables/useMotion'

/**
 * Features — "Что внутри". Asymmetric bento with 6 cards. Each carries
 * a small but recognisable mock of the actual feature UI (projector
 * slideshow, phone recording, voice bubble, swipe deck, venue map with
 * the upload window, Telegram chat). The `geofence` key is that upload
 * window card (the name is older than the copy). Hero card spans 2×2
 * on lg+, swipe card spans the row width on tablet. No scroll-driven
 * motion — entry is the shared staggered spring reveal, hover
 * brightens.
 */
const { t } = useI18n()

type CardKey = 'slideshow' | 'video' | 'voice' | 'swipe' | 'geofence' | 'telegram'

const ORDER: CardKey[] = ['slideshow', 'video', 'voice', 'swipe', 'geofence', 'telegram']
// `soon`: not live yet — the title carries the «скоро» pill.
const META: Record<CardKey, { hue: number; span: string; soon?: boolean }> = {
  slideshow: { hue: 25, span: 'sm:col-span-2 lg:col-span-2 lg:row-span-2' },
  video: { hue: 55, span: '' },
  voice: { hue: 75, span: '' },
  swipe: { hue: 35, span: 'sm:col-span-2 lg:col-span-1' },
  geofence: { hue: 15, span: '' },
  telegram: { hue: 220, span: '', soon: true },
}

const cards = computed(() =>
  ORDER.map((key, i) => ({
    key,
    index: i,
    hue: META[key].hue,
    span: META[key].span,
    soon: !!META[key].soon,
    title: t(`features.f${i + 1}Title`),
    desc: t(`features.f${i + 1}Desc`),
  })),
)

const titleWords = computed(() => t('features.title').split(' '))

const headRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
useReveal(headRef, { items: '[data-reveal]', stagger: 0.05, y: 22 })
useReveal(listRef, { items: ':scope > li', stagger: 0.07, y: 24, amount: 0.1 })
</script>

<template>
  <section
    id="features"
    class="relative overflow-hidden py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10"
  >
    <MarketingFloatingOrnaments :count="6" :hue-base="20" :hue-spread="70" />

    <div class="container-page relative">
      <div ref="headRef" class="mx-auto mb-6 max-w-2xl text-center md:mb-8 3xl:mb-10 4xl:mb-14">
        <p data-reveal aria-hidden="true" class="mb-3 text-[10px] uppercase tracking-[0.3em] text-(--color-primary) sm:text-xs">
          ⋄ ⋄ ⋄
        </p>
        <h2 class="heading-display-lg text-balance">
          <template v-for="(w, i) in titleWords" :key="i">
            <span data-reveal class="inline-block">{{ w }}</span>{{ i < titleWords.length - 1 ? ' ' : '' }}
          </template>
        </h2>
        <p data-reveal class="mt-4 text-pretty text-base text-(--color-muted-foreground) sm:text-lg">
          {{ t('features.subtitle') }}
        </p>
      </div>

      <!-- Layout:
           • Mobile (< sm): horizontal scroll-snap carousel so users
             swipe through the 6 features instead of scrolling through
             a long vertical strip. Each card takes ~82% of viewport
             width with the next card peeking on the right edge as a
             discoverability hint. Like the other carousels it runs to
             the screen edges (negative margin = the page gutter, given
             back as padding); centring only from sm, where it's a grid
             — `mx-auto` would override the bleed. Scrollbar hidden —
             swipes are the affordance. Cards stretch to the tallest
             one, so the row has no dead space and no card clips its
             text; all six are set alike here (the hero card only
             grows where it spans two rows).
           • sm+: asymmetric bento; rows are minmax(min, auto) so a long
             ru/uz description grows the row instead of being cut off.
             Hero card spans 2 cols × 2 rows on lg+. -->
      <ul ref="listRef" class="-mx-5 mt-6 flex max-w-6xl snap-x snap-mandatory scroll-px-5 gap-4 overflow-x-auto px-5 pb-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-auto sm:mt-0 sm:grid sm:auto-rows-[minmax(17rem,auto)] sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:p-0 lg:grid-cols-3 lg:gap-6 xl:max-w-[80rem] 2xl:max-w-[92rem] 2xl:auto-rows-[minmax(19rem,auto)] 2xl:gap-7 3xl:max-w-[108rem] 3xl:auto-rows-[minmax(22rem,auto)] 3xl:gap-8 4xl:max-w-[128rem] 4xl:auto-rows-[minmax(25rem,auto)] 4xl:gap-10">
        <li
          v-for="card in cards"
          :key="card.key"
          :class="[
            'group relative isolate flex w-[82%] shrink-0 snap-center flex-col overflow-hidden rounded-(--radius-xl) border border-(--color-border)/60 bg-white/80 backdrop-blur-sm transition-[border-color] duration-500 hover:border-(--color-primary)/40 sm:w-auto sm:shrink',
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

          <!-- Mockup stage: a FIXED height per breakpoint so every
               card's text starts on the same line and the mock (which
               is absolutely positioned inside) always has room. The
               text block below takes its natural height; the hero card
               lets its stage flex to fill its taller cell; from sm to lg
               that cell is one row, so the stage itself is tall enough
               for the whole 480×270 projector frame plus its padding. -->
          <div
            :class="[
              'relative shrink-0 overflow-hidden',
              card.key === 'slideshow'
                ? 'h-[13.5rem] sm:h-auto sm:min-h-[21rem] sm:flex-1 lg:min-h-[18rem] 3xl:min-h-[24rem]'
                : 'h-[13.5rem] sm:h-[12rem] lg:h-[13rem] 3xl:h-[15rem] 4xl:h-[17rem]',
            ]"
          >
            <MarketingMockup :card-key="card.key" :hue="card.hue" :is-hero="card.key === 'slideshow'" />
          </div>

          <!-- Text block — fills the rest of the (stretched) card; its
               height is never capped, so nothing is clipped. The hero
               card's text keeps its natural height and lets the stage
               take the extra room of the 2-row cell. -->
          <div
            :class="[
              'relative border-t border-(--color-border)/60 bg-white/70 backdrop-blur-sm',
              card.key === 'slideshow' ? 'flex-1 p-5 sm:flex-none sm:shrink-0 sm:p-7' : 'flex-1 p-5 sm:p-6',
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
                  ? 'text-lg text-(--color-foreground) sm:text-3xl 3xl:text-4xl 4xl:text-5xl'
                  : 'text-lg text-(--color-foreground) sm:text-xl 3xl:text-2xl 4xl:text-3xl'
              "
            ><MarketingSoonBadge v-if="card.soon" :text="card.title" /><template v-else>{{ card.title }}</template></h3>
            <p
              :class="[
                'mt-1.5 text-pretty leading-relaxed text-(--color-muted-foreground)',
                card.key === 'slideshow'
                  ? 'text-[13px] sm:text-base 3xl:text-lg 4xl:text-xl'
                  : 'text-[13px] sm:text-sm 3xl:text-base 4xl:text-lg',
              ]"
            >{{ card.desc }}</p>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
