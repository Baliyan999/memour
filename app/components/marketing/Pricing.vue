<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '#imports'
import { motion } from 'motion-v'
import { Check, Info, X } from '@lucide/vue'

/**
 * Pricing — 4 tiers with a 3D flip card mechanism. Info button on
 * the front face flips to a scrollable detail list on the back; the
 * X button on the back flips it back. All cards share the same
 * min-height so the row reads as a row even when one is flipped.
 */
const { t } = useI18n()

type Tier = {
  key: 'basic' | 'pro' | 'premium' | 'luxury'
  featureCount: number
  highlighted?: boolean
  luxe?: boolean
}

const TIERS: Tier[] = [
  { key: 'basic', featureCount: 5 },
  { key: 'pro', featureCount: 7, highlighted: true },
  { key: 'premium', featureCount: 6 },
  { key: 'luxury', featureCount: 7, luxe: true },
]

// One flip state per tier key — reactive.
const flipped = ref<Record<string, boolean>>({})

function toggle(key: string) {
  flipped.value[key] = !flipped.value[key]
}

const features = (key: string, count: number) =>
  Array.from({ length: count }, (_, j) => j + 1).map((k) => ({
    short: t(`pricing.${key}.f${k}`),
    desc: t(`pricing.${key}.f${k}Desc`),
  }))
</script>

<template>
  <section
    id="pricing"
    class="relative overflow-hidden py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10"
  >
    <MarketingFloatingOrnaments :count="12" :hue-base="45" />

    <div class="container-page relative">
      <MarketingReveal class="mx-auto max-w-2xl text-center">
        <p class="mb-3 text-[10px] uppercase tracking-[0.3em] text-(--color-primary) sm:text-xs">
          ⋄ ⋄ ⋄
        </p>
        <h2 class="heading-display-lg mb-3">{{ t('pricing.title') }}</h2>
        <p class="text-pretty text-base text-(--color-muted-foreground) sm:text-lg">
          {{ t('pricing.subtitle') }}
        </p>
      </MarketingReveal>

      <!-- Mobile: horizontal scroll-snap carousel so users swipe
           through tiers instead of scrolling through 4 stacked cards.
           From sm+ it switches back to the original grid. Negative
           horizontal margin lets the carousel bleed to the screen
           edge while the gutter pads the cards back inwards via
           `scroll-px` + per-item padding-ish margins. Scrollbar
           hidden on the carousel — taps + swipes are the affordance. -->
      <MarketingStagger
        class="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-6 pt-6 -mx-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:m-0 sm:grid sm:grid-cols-2 sm:items-start sm:gap-5 sm:overflow-visible sm:p-0 md:mt-10 md:gap-6 lg:grid-cols-4 lg:gap-5 2xl:gap-6 3xl:mt-14 3xl:gap-7 4xl:mt-20 4xl:gap-10"
        :step="0.1"
      >
        <MarketingStaggerItem
          v-for="tier in TIERS"
          :key="tier.key"
          class="w-[82%] shrink-0 snap-center sm:w-auto sm:shrink"
        >
          <motion.div
            :while-hover="{ y: tier.highlighted || tier.luxe ? -6 : -3 }"
            :transition="{ type: 'spring', stiffness: 280, damping: 20 }"
            :style="{
              perspective: '1500px',
              '--tier-min-h': '33rem',
            }"
            class="relative h-full w-full [min-height:var(--tier-min-h)] 3xl:[min-height:calc(var(--tier-min-h)+4rem)] 4xl:[min-height:calc(var(--tier-min-h)+8rem)]"
          >
            <!-- Highlight/Luxe badge above the card -->
            <div
              v-if="tier.highlighted"
              class="pointer-events-none absolute -top-3.5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-(--color-primary) px-3.5 py-1.5 text-[10px] uppercase tracking-[0.2em] text-(--color-primary-foreground) shadow-(--shadow-soft)"
            >{{ t('pricing.popular') }}</div>
            <div
              v-if="tier.luxe"
              class="pointer-events-none absolute -top-3.5 left-1/2 z-20 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-[10px] uppercase tracking-[0.2em] shadow-(--shadow-soft)"
              :style="{
                background: 'linear-gradient(135deg, oklch(70% 0.12 50), oklch(85% 0.08 75))',
                color: 'oklch(20% 0.04 35)',
              }"
            >★ Эксклюзив</div>

            <motion.div
              :animate="{ rotateY: flipped[tier.key] ? 180 : 0 }"
              :transition="{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }"
              :style="{ transformStyle: 'preserve-3d' }"
              class="relative w-full [min-height:var(--tier-min-h)] 3xl:[min-height:calc(var(--tier-min-h)+4rem)] 4xl:[min-height:calc(var(--tier-min-h)+8rem)]"
            >
              <!-- FRONT FACE -->
              <div
                :class="[
                  'flex flex-col overflow-hidden rounded-(--radius-xl) p-5 sm:p-6 md:p-7 3xl:p-9 4xl:p-12',
                  tier.highlighted && 'border border-(--color-primary)/40 shadow-(--shadow-glow)',
                  tier.luxe && 'border border-(--color-foreground)/30 shadow-[0_24px_60px_-20px_rgb(60_30_15_/_0.35)]',
                  !tier.highlighted && !tier.luxe && 'border border-(--color-border) bg-white/70 shadow-(--shadow-soft) backdrop-blur',
                  '[min-height:var(--tier-min-h)] 3xl:[min-height:calc(var(--tier-min-h)+4rem)] 4xl:[min-height:calc(var(--tier-min-h)+8rem)]',
                ]"
                :style="{
                  ...(tier.highlighted ? { background: 'linear-gradient(180deg, oklch(98% 0.02 70) 0%, oklch(94% 0.04 60) 100%)' } : {}),
                  ...(tier.luxe ? { background: 'linear-gradient(180deg, oklch(24% 0.04 50) 0%, oklch(18% 0.05 40) 100%)', color: 'oklch(95% 0.02 70)' } : {}),
                  backfaceVisibility: 'hidden',
                }"
              >
                <button
                  type="button"
                  :aria-label="t('pricing.detailsTitle')"
                  :class="[
                    'absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors',
                    tier.luxe
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                      : 'bg-(--color-background)/70 text-(--color-muted-foreground) hover:bg-(--color-background) hover:text-(--color-primary)',
                  ]"
                  @click="toggle(tier.key)"
                >
                  <Info class="h-3.5 w-3.5" :stroke-width="1.8" />
                  {{ t('pricing.detailsCta') }}
                </button>

                <h3 class="font-display text-xl sm:text-2xl md:text-3xl 3xl:text-4xl 4xl:text-5xl">
                  {{ t(`pricing.${tier.key}.name`) }}
                </h3>
                <div class="mt-3 flex items-baseline gap-2 md:mt-4">
                  <span
                    :class="[
                      'font-display text-2xl tracking-tight sm:text-3xl md:text-4xl 3xl:text-5xl 4xl:text-6xl',
                      tier.highlighted && 'text-gradient-gold',
                    ]"
                    :style="tier.luxe ? {
                      background: 'linear-gradient(120deg, oklch(82% 0.1 70), oklch(90% 0.08 50), oklch(78% 0.12 30))',
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                    } : undefined"
                  >{{ t(`pricing.${tier.key}.price`) }}</span>
                  <span :class="['text-sm', tier.luxe ? 'text-white/60' : 'text-(--color-muted-foreground)']">
                    {{ t('pricing.currency') }}
                  </span>
                </div>
                <p :class="['mt-1 text-xs uppercase tracking-[0.18em]', tier.luxe ? 'text-white/50' : 'text-(--color-muted-foreground)']">
                  {{ t('pricing.perEvent') }}
                </p>

                <div :class="['my-3 h-px md:my-5', tier.luxe ? 'bg-white/15' : 'bg-(--color-border)']" />

                <ul class="flex flex-1 flex-col gap-2.5 text-sm md:gap-3.5 3xl:gap-4 3xl:text-base 4xl:gap-5 4xl:text-lg">
                  <li
                    v-for="(f, j) in features(tier.key, tier.featureCount)"
                    :key="j"
                    class="flex items-start gap-3"
                  >
                    <span
                      :class="[
                        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                        tier.luxe ? 'bg-white/10 text-(--color-champagne)' : 'bg-(--color-accent)/60 text-(--color-primary)',
                      ]"
                    >
                      <Check class="h-3 w-3" :stroke-width="3" />
                    </span>
                    <span>{{ f.short }}</span>
                  </li>
                </ul>

                <a
                  href="#lead"
                  :class="[
                    'mt-5 inline-flex h-12 items-center justify-center rounded-md px-8 text-base font-medium shadow-(--shadow-soft) transition-all md:mt-7',
                    !tier.luxe && tier.highlighted && 'bg-(--color-primary) text-(--color-primary-foreground) hover:opacity-90',
                    !tier.luxe && !tier.highlighted && 'bg-(--color-accent) text-(--color-accent-foreground) hover:opacity-90',
                    tier.luxe && 'hover:opacity-90',
                  ]"
                  :style="tier.luxe ? {
                    background: 'linear-gradient(135deg, oklch(80% 0.1 60), oklch(88% 0.08 75))',
                    color: 'oklch(20% 0.04 35)',
                  } : undefined"
                >{{ t('pricing.ctaSelect') }}</a>
              </div>

              <!-- BACK FACE -->
              <div
                :class="[
                  'flex flex-col overflow-hidden rounded-(--radius-xl) p-5 sm:p-6 md:p-7 3xl:p-9 4xl:p-12 absolute inset-0',
                  tier.highlighted && 'border border-(--color-primary)/40 shadow-(--shadow-glow)',
                  tier.luxe && 'border border-(--color-foreground)/30 shadow-[0_24px_60px_-20px_rgb(60_30_15_/_0.35)]',
                  !tier.highlighted && !tier.luxe && 'border border-(--color-border) bg-white/70 shadow-(--shadow-soft) backdrop-blur',
                ]"
                :style="{
                  ...(tier.highlighted ? { background: 'linear-gradient(180deg, oklch(98% 0.02 70) 0%, oklch(94% 0.04 60) 100%)' } : {}),
                  ...(tier.luxe ? { background: 'linear-gradient(180deg, oklch(24% 0.04 50) 0%, oklch(18% 0.05 40) 100%)', color: 'oklch(95% 0.02 70)' } : {}),
                  backfaceVisibility: 'hidden',
                  transform: 'rotateY(180deg)',
                }"
              >
                <button
                  type="button"
                  aria-label="Close"
                  :class="[
                    'absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full transition-colors',
                    tier.luxe
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                      : 'bg-(--color-background)/70 text-(--color-muted-foreground) hover:bg-(--color-background) hover:text-(--color-primary)',
                  ]"
                  @click="toggle(tier.key)"
                >
                  <X class="h-4 w-4" :stroke-width="2" />
                </button>

                <div class="mb-3 flex items-baseline justify-between gap-3 pr-12">
                  <h3 class="font-display text-xl sm:text-2xl md:text-3xl 3xl:text-4xl 4xl:text-5xl">
                    {{ t(`pricing.${tier.key}.name`) }}
                  </h3>
                  <span :class="['text-[10px] uppercase tracking-[0.2em]', tier.luxe ? 'text-white/50' : 'text-(--color-muted-foreground)']">
                    {{ t('pricing.detailsTitle') }}
                  </span>
                </div>

                <div :class="['mb-3 h-px', tier.luxe ? 'bg-white/15' : 'bg-(--color-border)']" />

                <ul class="scrollbar-slim flex flex-1 flex-col gap-3.5 overflow-y-auto pr-1 text-sm md:gap-4">
                  <li
                    v-for="(f, j) in features(tier.key, tier.featureCount)"
                    :key="j"
                    class="flex flex-col gap-1"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        :class="[
                          'grid h-4 w-4 shrink-0 place-items-center rounded-full',
                          tier.luxe ? 'bg-white/10 text-(--color-champagne)' : 'bg-(--color-accent)/60 text-(--color-primary)',
                        ]"
                      >
                        <Check class="h-2.5 w-2.5" :stroke-width="3" />
                      </span>
                      <span class="font-medium">{{ f.short }}</span>
                    </div>
                    <p :class="['pl-6 text-xs leading-relaxed', tier.luxe ? 'text-white/60' : 'text-(--color-muted-foreground)']">
                      {{ f.desc }}
                    </p>
                  </li>
                </ul>
              </div>
            </motion.div>
          </motion.div>
        </MarketingStaggerItem>
      </MarketingStagger>
    </div>
  </section>
</template>
