<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n, useState } from '#imports'
import { motion } from 'motion-v'
import { Check, ChevronDown, Info, X } from '@lucide/vue'
import { SPRING } from '~/composables/useMotion'

/**
 * Pricing — 4 tiers with a 3D flip card mechanism. Info button on
 * the front face flips to a scrollable detail list on the back; the
 * X button on the back flips it back. Cards share a min-height and
 * stretch to the tallest card of the grid, so the rows stay even with
 * any locale's line wraps and while a card is flipped. A back list
 * that doesn't fit fades out at the bottom under an «ещё N» pill.
 *
 * Depth: hover lifts the card and fades in a deeper shadow layer;
 * pressing anywhere sinks it slightly (feedback on pointer-down, CSS
 * `.press` — a JS press gesture would make the card a tab stop). The
 * flip is a critically damped spring, so a second tap mid-flip just
 * turns it back from wherever it is. The face that's turned away is
 * `inert` — out of the tab order and the accessibility tree.
 *
 * Reduced motion, in CSS so it holds before hydration and without a
 * MotionConfig: no lift and no turn — the faces cross-fade in place.
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

// Focus follows the flip so keyboard users land on the visible face.
const faceButtons = new Map<string, HTMLElement>()
function setFaceButton(key: string, el: unknown) {
  if (el instanceof HTMLElement) faceButtons.set(key, el)
}
// Which face points at the viewer, from the live angle. Safari paints
// separately composited children (the «Подробнее» chip) through
// `backface-visibility`, mirrored on the other face, so the face that has
// turned away is also `visibility: hidden` — switched as the card passes
// 90°, not when the turn starts. Focus waits for its face to show up
// (hidden elements can't take focus).
const backShown = ref<Record<string, boolean>>({})
const pendingFocus = new Map<string, ReturnType<typeof setTimeout>>()
function showFace(key: string, back: boolean) {
  if (backShown.value[key] !== back) backShown.value[key] = back
  if (pendingFocus.has(key) && back === !!flipped.value[key]) {
    clearTimeout(pendingFocus.get(key))
    pendingFocus.delete(key)
    nextTick(() => faceButtons.get(`${key}:${back ? 'back' : 'front'}`)?.focus({ preventScroll: true }))
  }
}
function onTurn(key: string, latest: Record<string, unknown>) {
  const deg = Number.parseFloat(String(latest.rotateY ?? 0)) || 0
  showFace(key, Math.abs(deg % 360) > 90)
}
function toggle(key: string) {
  flipped.value[key] = !flipped.value[key]
  // Fallback in case no animation frame reports the angle (instant turn).
  clearTimeout(pendingFocus.get(key))
  pendingFocus.set(key, setTimeout(() => showFace(key, !!flipped.value[key]), 900))
}

// Back-face list. When it's longer than the face (`scrolls`), its
// bottom fades out and the «ещё N» pill counts the items whose title
// can't be read yet (its middle is past the middle of that fade): an item
// whose title shows is seen, even if its description is cut. The cue
// holds wherever the lines happen to fall, overlay scrollbars or not.
// A list that fits gets neither. `n` keeps the last count, so the pill
// doesn't read «ещё 0» while it fades out.
const cue = ref<Record<string, { scrolls: boolean; n: number; on: boolean }>>({})
const lists = new Map<string, HTMLElement>()
function setList(key: string, el: unknown) {
  if (el instanceof HTMLElement) lists.set(key, el)
}

// Layout offsets, not client rects: the back face is turned, and
// mid-flip its rects are skewed by the perspective. An item's own
// bottom padding (the last one's, as tall as the fade, lets it scroll
// clear of it) doesn't count as content.
const bottomPad = (el: Element) => parseFloat(getComputedStyle(el).paddingBottom)
// Where lines stop being readable, px from the top of the list's
// content: the fade runs from --fade above the bottom (opaque) down to
// --clear (gone); its middle is where a line is half-visible. Both in rem.
function seenTo(ul: HTMLElement) {
  const css = getComputedStyle(ul)
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const half = (parseFloat(css.getPropertyValue('--fade')) + parseFloat(css.getPropertyValue('--clear'))) / 2 * rem
  return ul.scrollTop + ul.clientHeight - half
}
const items = (ul: HTMLElement) => Array.from(ul.children) as HTMLElement[]
// Items not seen to their last line — the pill pages to the first one.
function unseen(ul: HTMLElement) {
  const seen = seenTo(ul)
  return items(ul).filter((li) => li.offsetTop + li.offsetHeight - bottomPad(li) > seen + 1)
}
// Items whose title isn't readable yet — what the pill counts.
function untitled(ul: HTMLElement) {
  const seen = seenTo(ul)
  // The title row and the list item share the list as offset parent.
  return items(ul).filter((li) => {
    const title = (li.firstElementChild as HTMLElement | null) ?? li
    return title.offsetTop + title.offsetHeight / 2 > seen
  })
}

let frame = 0
function measure() {
  frame = 0
  for (const [key, ul] of lists) {
    const last = ul.lastElementChild
    if (!last) continue
    // Measured without the end padding, so adding it can't flip the answer.
    const scrolls = ul.scrollHeight - bottomPad(last) > ul.clientHeight + 1
    const n = scrolls ? untitled(ul).length : 0
    // Runs on every scroll frame: re-render only when something changed.
    const prev = cue.value[key]
    if (prev && prev.scrolls === scrolls && prev.on === n > 0 && (!n || prev.n === n)) continue
    cue.value[key] = { scrolls, n: n || prev?.n || 0, on: n > 0 }
  }
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(measure)
}

// The pill pages the list: the first item not fully seen comes up to
// the top, clear of the top fade.
function showMore(key: string) {
  const ul = lists.get(key)
  const next = ul && unseen(ul)[0]
  if (!ul || !next) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ul.scrollTo({ top: next.offsetTop - parseFloat(getComputedStyle(ul).paddingTop), behavior: reduce ? 'auto' : 'smooth' })
}

// Sizes change with the viewport, the web font swap and the locale:
// watch the lists and each item.
let ro: ResizeObserver | undefined
onMounted(() => {
  ro = new ResizeObserver(schedule)
  for (const ul of lists.values()) {
    ro.observe(ul)
    for (const li of Array.from(ul.children)) ro.observe(li)
  }
  schedule()
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(frame)
  pendingFocus.forEach(clearTimeout)
})

// Luxury surface, both faces: a champagne hairline and a lit top edge
// instead of a dark rim, and a close warm shadow from the page's
// family (--shadow-soft, one step deeper for the dark card) instead of
// a wide dark-brown halo.
const LUXE_SURFACE = 'border border-(--color-champagne)/20 shadow-[inset_0_1px_0_rgb(255_240_220/0.1),0_1px_2px_rgb(60_30_15/0.08),0_12px_28px_-12px_rgb(140_90_60/0.4)]'

// The chosen tier travels to the lead form (LeadForm reads 'leadTier').
const leadTier = useState<string | null>('leadTier', () => null)

const features = (key: string, count: number) =>
  Array.from({ length: count }, (_, j) => j + 1).map((k) => ({
    short: t(`pricing.${key}.f${k}`),
    desc: t(`pricing.${key}.f${k}Desc`),
  }))
</script>

<template>
  <!-- Clipped sideways only (the carousel bleeds past the gutter):
       the cards' shadows fall past the section's bottom edge instead
       of being cut off there. -->
  <section
    id="pricing"
    class="relative overflow-x-clip py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10"
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
           hidden on the carousel — taps + swipes are the affordance.
           Items stretch (the flex and grid default) and every row is
           as tall as the tallest (auto-rows-fr), so the cards line up
           whatever wraps. Four across from 72rem: below that (iPad
           landscape) a column is so narrow that the Luxury features
           wrap onto three lines each, so the tiers go two by two. -->
      <MarketingStagger
        class="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-6 pt-6 -mx-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:m-0 sm:grid sm:auto-rows-fr sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:p-0 md:mt-10 md:gap-6 lg:mx-auto lg:max-w-4xl min-[72rem]:max-w-none min-[72rem]:grid-cols-4 min-[72rem]:gap-5 2xl:gap-6 3xl:mt-14 3xl:gap-7 4xl:mt-20 4xl:gap-10"
        :step="0.1"
      >
        <MarketingStaggerItem
          v-for="tier in TIERS"
          :key="tier.key"
          class="flex w-[82%] shrink-0 snap-center flex-col sm:w-auto sm:shrink"
        >
          <motion.div
            :while-hover="{ y: tier.highlighted || tier.luxe ? -6 : -4 }"
            :transition="SPRING.default"
            :style="{
              perspective: '1500px',
              '--tier-min-h': '33rem',
            }"
            class="press group/tier relative flex w-full flex-1 flex-col [--press-scale:0.985] [min-height:var(--tier-min-h)] motion-reduce:transform-none! 3xl:[min-height:calc(var(--tier-min-h)+4rem)] 4xl:[min-height:calc(var(--tier-min-h)+8rem)]"
          >
            <!-- Depth: a deeper shadow that fades in under the lifted
                 card (opacity only — the shadow itself never animates). -->
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-2 -z-10 rounded-(--radius-xl) opacity-0 shadow-(--shadow-lift) transition-opacity duration-(--spring-default) ease-(--ease-spring) group-hover/tier:opacity-100"
            />
            <!-- Highlight/Luxe badge centred on the card's top edge
                 (a translate, so the font's line box can't shift it).
                 One line at every width, short enough to clear the chip. -->
            <div
              v-if="tier.highlighted"
              class="pointer-events-none absolute top-0 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-(--color-primary) px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-(--color-primary-foreground) shadow-(--shadow-soft)"
            >{{ t('pricing.popular') }}</div>
            <div
              v-if="tier.luxe"
              class="pointer-events-none absolute top-0 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.3),0_4px_12px_-4px_rgb(140_90_60/0.45)]"
              :style="{
                background: 'linear-gradient(135deg, oklch(76% 0.1 55), oklch(88% 0.07 80))',
                color: 'oklch(22% 0.04 40)',
              }"
            >{{ t('pricing.exclusive') }}</div>

            <!-- The turning part fills the card, and the front face fills
                 it, so faces and CTAs line up across a stretched row. The
                 back face is absolute: it never makes a card taller, its
                 list scrolls instead. -->
            <motion.div
              :animate="{ rotateY: flipped[tier.key] ? 180 : 0 }"
              :transition="SPRING.gentle"
              :on-update="(latest: Record<string, unknown>) => onTurn(tier.key, latest)"
              :style="{ transformStyle: 'preserve-3d' }"
              class="relative flex w-full flex-1 flex-col motion-reduce:transform-none!"
            >
              <!-- FRONT FACE -->
              <div
                :inert="!!flipped[tier.key]"
                :class="[
                  'flex flex-1 flex-col overflow-hidden rounded-(--radius-xl) p-5 sm:p-6 md:p-7 3xl:p-9 4xl:p-12 motion-reduce:[transition:opacity_200ms_ease-out]!',
                  flipped[tier.key] && 'motion-reduce:opacity-0',
                  tier.highlighted && 'border border-(--color-primary)/40 shadow-(--shadow-glow)',
                  tier.luxe && LUXE_SURFACE,
                  !tier.highlighted && !tier.luxe && 'border border-(--color-border) bg-white/70 shadow-(--shadow-soft) backdrop-blur',
                ]"
                :style="{
                  ...(tier.highlighted ? { background: 'linear-gradient(180deg, oklch(98% 0.02 70) 0%, oklch(94% 0.04 60) 100%)' } : {}),
                  ...(tier.luxe ? { background: 'linear-gradient(180deg, oklch(24% 0.04 50) 0%, oklch(18% 0.05 40) 100%)', color: 'oklch(95% 0.02 70)' } : {}),
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  visibility: backShown[tier.key] ? 'hidden' : undefined,
                }"
              >
                <!-- Same spot on every card, clear of the badge; the back's
                     close button sits on the same centre line. -->
                <button
                  :ref="(el) => setFaceButton(`${tier.key}:front`, el)"
                  type="button"
                  :aria-label="`${t('pricing.detailsCta')} — ${t(`pricing.${tier.key}.name`)}`"
                  :class="[
                    'press absolute top-4 right-3 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs',
                    tier.luxe
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                      : 'bg-(--color-background)/70 text-(--color-muted-foreground) hover:bg-(--color-background) hover:text-(--color-primary)',
                  ]"
                  @click="toggle(tier.key)"
                >
                  <Info class="h-3.5 w-3.5" :stroke-width="1.8" aria-hidden="true" />
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
                    <!-- Balanced, so a label that wraps in a narrow
                         column breaks into two even lines. -->
                    <span class="text-balance">{{ f.short }}</span>
                  </li>
                </ul>

                <a
                  href="#lead"
                  :class="[
                    'press mt-5 inline-flex h-12 items-center justify-center rounded-md px-8 text-base font-medium shadow-(--shadow-soft) md:mt-7',
                    !tier.luxe && tier.highlighted && 'bg-(--color-primary) text-(--color-primary-foreground) hover:opacity-90',
                    !tier.luxe && !tier.highlighted && 'bg-(--color-accent) text-(--color-accent-foreground) hover:opacity-90',
                    tier.luxe && 'hover:opacity-90',
                  ]"
                  :style="tier.luxe ? {
                    background: 'linear-gradient(135deg, oklch(80% 0.1 60), oklch(88% 0.08 75))',
                    color: 'oklch(20% 0.04 35)',
                  } : undefined"
                  @click="leadTier = tier.key"
                >{{ t('pricing.ctaSelect') }}</a>
              </div>

              <!-- BACK FACE -->
              <div
                :inert="!flipped[tier.key]"
                :class="[
                  'flex flex-col overflow-hidden rounded-(--radius-xl) p-5 sm:p-6 md:p-7 3xl:p-9 4xl:p-12 absolute inset-0 motion-reduce:transform-none! motion-reduce:[transition:opacity_200ms_ease-out]!',
                  !flipped[tier.key] && 'motion-reduce:opacity-0',
                  tier.highlighted && 'border border-(--color-primary)/40 shadow-(--shadow-glow)',
                  tier.luxe && LUXE_SURFACE,
                  !tier.highlighted && !tier.luxe && 'border border-(--color-border) bg-white/70 shadow-(--shadow-soft) backdrop-blur',
                ]"
                :style="{
                  ...(tier.highlighted ? { background: 'linear-gradient(180deg, oklch(98% 0.02 70) 0%, oklch(94% 0.04 60) 100%)' } : {}),
                  ...(tier.luxe ? { background: 'linear-gradient(180deg, oklch(24% 0.04 50) 0%, oklch(18% 0.05 40) 100%)', color: 'oklch(95% 0.02 70)' } : {}),
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  visibility: backShown[tier.key] ? undefined : 'hidden',
                  transform: 'rotateY(180deg)',
                }"
              >
                <button
                  :ref="(el) => setFaceButton(`${tier.key}:back`, el)"
                  type="button"
                  :aria-label="t('pricing.flipBack')"
                  :class="[
                    'press absolute top-3.5 right-3 z-10 grid h-8 w-8 place-items-center rounded-full',
                    tier.luxe
                      ? 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
                      : 'bg-(--color-background)/70 text-(--color-muted-foreground) hover:bg-(--color-background) hover:text-(--color-primary)',
                  ]"
                  @click="toggle(tier.key)"
                >
                  <X class="h-4 w-4" :stroke-width="2" aria-hidden="true" />
                </button>

                <!-- Label above the name: one clean line each at any column
                     width (side by side, the label wrapped and spilled). -->
                <div class="mb-3 pr-12">
                  <p :class="['text-[10px] uppercase tracking-[0.2em]', tier.luxe ? 'text-white/50' : 'text-(--color-muted-foreground)']">
                    {{ t('pricing.detailsTitle') }}
                  </p>
                  <h3 class="mt-1 font-display text-xl sm:text-2xl md:text-3xl 3xl:text-4xl 4xl:text-5xl">
                    {{ t(`pricing.${tier.key}.name`) }}
                  </h3>
                </div>

                <div :class="['h-px', tier.luxe ? 'bg-white/15' : 'bg-(--color-border)']" />

                <!-- Longer than the card in a narrow column, so it scrolls.
                     Then its edges fade (a mask, so nothing moves): the
                     bottom one from --fade to --clear above the bottom,
                     fully gone below that — a band as tall as the pill
                     plus a clear gap, so the pill never sits on a line.
                     The last item's padding, as tall as the fade, lets
                     it scroll clear. -->
                <div class="relative flex min-h-0 flex-1 flex-col">
                  <ul
                    :ref="(el) => setList(tier.key, el)"
                    :class="[
                      'scrollbar-slim relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1 pt-3 text-sm [--clear:2.5rem] [--fade:4.5rem] md:gap-4',
                      cue[tier.key]?.scrolls !== false && '[mask-image:linear-gradient(to_bottom,transparent,#000_0.75rem,#000_calc(100%-var(--fade)),transparent_calc(100%-var(--clear)))]',
                    ]"
                    @scroll.passive="schedule"
                  >
                    <li
                      v-for="(f, j) in features(tier.key, tier.featureCount)"
                      :key="j"
                      :class="['flex flex-col gap-1', cue[tier.key]?.scrolls !== false && 'last:pb-(--fade)']"
                    >
                      <!-- Tick on the first line, as on the front. -->
                      <div class="flex items-start gap-2">
                        <span
                          :class="[
                            'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                            tier.luxe ? 'bg-white/10 text-(--color-champagne)' : 'bg-(--color-accent)/60 text-(--color-primary)',
                          ]"
                        >
                          <Check class="h-2.5 w-2.5" :stroke-width="3" />
                        </span>
                        <span class="font-medium text-balance">{{ f.short }}</span>
                      </div>
                      <p :class="['pl-6 text-xs leading-relaxed', tier.luxe ? 'text-white/60' : 'text-(--color-muted-foreground)']">
                        {{ f.desc }}
                      </p>
                    </li>
                  </ul>

                  <!-- «ещё N», in the clear bottom of the fade. Rises in
                       on the default spring, a plain fade under reduced
                       motion; a tap pages the list. Pointer-only: the
                       list itself is read and scrolled as usual. -->
                  <div
                    :class="[
                      'pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center transition-[opacity,translate] duration-(--spring-default) ease-(--ease-spring) motion-reduce:translate-y-0! motion-reduce:[transition:opacity_200ms_ease-out]!',
                      cue[tier.key]?.on ? 'opacity-100' : 'translate-y-1.5 opacity-0',
                    ]"
                  >
                    <button
                      type="button"
                      tabindex="-1"
                      aria-hidden="true"
                      :class="[
                        'press inline-flex items-center gap-1 rounded-full py-1 pr-2.5 pl-3 text-[10px] uppercase tracking-[0.16em]',
                        cue[tier.key]?.on && 'pointer-events-auto',
                        tier.luxe
                          ? 'bg-white/12 text-white/80 shadow-[inset_0_0_0_1px_rgb(255_240_220/0.12)] hover:bg-white/20 hover:text-white'
                          : 'bg-(--color-background)/85 text-(--color-muted-foreground) shadow-(--shadow-soft) hover:text-(--color-primary)',
                      ]"
                      @click="showMore(tier.key)"
                    >
                      {{ t('pricing.more', { n: cue[tier.key]?.n ?? 0 }) }}
                      <ChevronDown class="h-3 w-3" :stroke-width="2" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </MarketingStaggerItem>
      </MarketingStagger>
    </div>
  </section>
</template>
