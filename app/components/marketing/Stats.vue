<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from '#imports'
import { inView, motion } from 'motion-v'
import { FolderHeart } from '@lucide/vue'
import { SPRING } from '~/composables/useMotion'

/**
 * Stats — the product's three limits (not adoption metrics), each on
 * its own glass tile with a small live picture of what the number
 * means:
 *   50 — guests' photos landing on a stack, one after another
 *   15 — a round video message recording, the ring filling to 0:15
 *   12 — a year dial lighting up month by month
 *
 * Two timelines per tile, all in CSS, both on the spring curve: the
 * registered custom property --stat-p runs 0 → 1 and drives the
 * recording ring and the month segments; --stat-c runs the count (a
 * CSS counter) 140 ms behind it. The photos are dealt on their own
 * staggered springs. Only transform / opacity move (plus the dash of
 * one 100 px ring). The number is set in lining, tabular figures, so
 * it counts without jitter and without shifting the layout — the
 * final value reserves the width.
 *
 * Nothing waits for JavaScript: the SSR HTML carries the whole
 * entrance, starting as the hero's own entrance settles (tablets and
 * tall screens see it on load). After mount, a tile still below the
 * fold — or one peeking in that hasn't started yet — is parked and
 * replays when it scrolls into view, so it's never pulled away from a
 * state the user already sees. The count waits for its own digits:
 * where the picture is in view but the number is still under the fold
 * (a tablet in portrait), the picture plays and the number holds at 0
 * until its digits scroll into view. No JS, or a browser without
 * @property: the entrance still ends on the final state, and the real
 * number is shown instead of the counter. Reduced motion: final state
 * at once.
 *
 * Short screens (phones held sideways, < 30rem tall) keep the phone's
 * tile — picture beside the number — in the three columns, with a
 * smaller picture and number, so a whole tile fits on the screen.
 */
const { t } = useI18n()

// 50 = the top tiers' per-guest photo limit (server/utils/guest-quota.ts),
// the same "up to 50" the hero promises. 15 s = the guest video cap
// (GuestVideo MAX_MS). 12 months = Luxury keeps the archive 365 days
// after the wedding (set_event_archive_expiry).
const ITEMS = [
  { kind: 'photos', value: 50, suffixKey: 'statsPromo.suffix1', labelKey: 'statsPromo.label1' },
  { kind: 'video', value: 15, suffixKey: 'statsPromo.suffix2', labelKey: 'statsPromo.label2' },
  { kind: 'archive', value: 12, suffixKey: 'statsPromo.suffix3', labelKey: 'statsPromo.label3' },
] as const

const items = computed(() => {
  const prefix = t('statsPromo.prefix').trim()
  return ITEMS.map((item) => {
    const suffix = t(item.suffixKey).trim()
    const label = t(item.labelKey)
    return { ...item, prefix, suffix, label, spoken: [prefix, item.value, suffix, label].filter(Boolean).join(' ') }
  })
})

// Photo stack, bottom → top: resting pose of each card, in em of the
// stage (the stage's font-size scales the whole picture per breakpoint).
const DECK = [
  { name: 'stats-deck-confetti', x: -2.05, y: 0.55, r: -13 },
  { name: 'stats-deck-sparklers', x: 2.05, y: 0.45, r: 12 },
  { name: 'stats-deck-champagne', x: -1, y: 0, r: -6 },
  { name: 'stats-deck-embrace', x: 1.05, y: 0.05, r: 5.5 },
  { name: 'stats-deck-dance', x: 0, y: -0.2, r: -1 },
] as const
// Rendered widths: 6.2em of the stage (see its font-size per breakpoint).
const DECK_SIZES = '(min-width: 2560px) 143px, (min-width: 1920px) 109px, (min-width: 1536px) 90px, 84px'
const SELFIE_SIZES = '(min-width: 2560px) 191px, (min-width: 1920px) 145px, (min-width: 1536px) 120px, 112px'

// Year dial: 12 rounded segments on a 100-unit circle, champagne gold
// deepening to rose gold as the months pass.
const MONTHS = Array.from({ length: 12 }, (_, k) => {
  const r = 44
  const at = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(50 + r * Math.sin(a)).toFixed(2)}`
  }
  const start = -90 + k * 30 + 6
  return {
    d: `M ${at(start)} A ${r} ${r} 0 0 1 ${at(start + 18)}`,
    color: `oklch(${(79 - k * 1.9).toFixed(1)}% ${(0.085 + k * 0.002).toFixed(3)} ${(78 - k * 3.8).toFixed(1)})`,
  }
})

// Entrance delays (ms). On first paint the tiles follow the hero's
// bullets; on a scroll-in the tiles of one row ripple left to right.
// The count starts COUNT_LAG after its tile, as the first photo lands.
const FIRST_PAINT = 600
const STEP = 90
const COUNT_LAG = 140
const delays = ref<number[]>(ITEMS.map((_, i) => FIRST_PAINT + i * STEP))
const countDelays = ref<number[]>(ITEMS.map((_, i) => FIRST_PAINT + i * STEP + COUNT_LAG))
const parked = ref<boolean[]>(ITEMS.map(() => false))
const countParked = ref<boolean[]>(ITEMS.map(() => false))

const tiles: HTMLElement[] = []
const digits: HTMLElement[] = []
function setTile(i: number, el: unknown) {
  if (el instanceof HTMLElement) tiles[i] = el
}
function setDigits(i: number, el: unknown) {
  if (el instanceof HTMLElement) digits[i] = el
}

// Part of an element inside the viewport, 0…1 (it may run past the top).
function visible(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return (Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)) / rect.height
}

const stops: VoidFunction[] = []
onMounted(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const row = window.matchMedia('(min-width: 768px)').matches
  // When each tile's entrance clock started (performance.now() time):
  // its first-paint animation's start, or the moment it was let go.
  const began = tiles.map((el) => {
    const start = el.getAnimations()[0]?.startTime
    return typeof start === 'number' ? start : 0
  })

  // The count runs once its digits are in view, still COUNT_LAG after
  // its tile if the tile has only just started rising.
  const watchCount = (i: number) => {
    const el = digits[i]
    if (!el) return
    const run = () => {
      const lag = (began[i] ?? 0) + (delays.value[i] ?? 0) + COUNT_LAG - performance.now()
      countDelays.value[i] = Math.round(Math.max(row ? i * STEP : 0, lag))
      countParked.value[i] = false
    }
    if (visible(el) >= 0.9) return run()
    const stop = inView(el, () => {
      run()
      stop()
    }, { amount: 0.9 })
    stops.push(stop)
  }

  tiles.forEach((el, i) => {
    const rect = el.getBoundingClientRect()
    if (rect.bottom <= 0) return // above the viewport (restored scroll)
    const shown = (window.innerHeight - rect.top) / rect.height
    // Still transparent = its first-paint entrance hasn't begun, so
    // parking it changes nothing on screen.
    const notStarted = Number.parseFloat(getComputedStyle(el).opacity) < 0.05
    if (shown > 0 && !(shown < 0.5 && notStarted)) {
      // The tile stays. Its count is parked while the digits can't be
      // read — invisible either way: they're under the fold, or still
      // at 0 (--stat-c is 0 until the count begins).
      const digitsEl = digits[i]
      if (!digitsEl) return
      const seen = visible(digitsEl)
      const counting = Number.parseFloat(getComputedStyle(digitsEl).getPropertyValue('--stat-c')) > 0
      if (seen >= 0.9 || (seen > 0 && counting)) return
      countParked.value[i] = true
      watchCount(i)
      return
    }
    parked.value[i] = true
    countParked.value[i] = true
    const stop = inView(el, () => {
      began[i] = performance.now()
      delays.value[i] = row ? i * STEP : 0
      parked.value[i] = false
      watchCount(i)
      stop()
    }, { amount: 0.45 })
    stops.push(stop)
  })
})
onBeforeUnmount(() => stops.forEach((stop) => stop()))
</script>

<template>
  <section class="relative overflow-x-clip py-10 md:py-14 xl:py-16 3xl:py-20 4xl:py-24 [@media(max-height:30rem)]:pt-4!">
    <MarketingFloatingOrnaments :count="10" />

    <div class="container-page relative">
      <MarketingReveal
        class="mx-auto mb-6 flex max-w-md items-center justify-center md:mb-8 xl:mb-10 3xl:mb-12 3xl:max-w-xl 4xl:max-w-2xl"
      >
        <span aria-hidden="true" class="h-px flex-1 bg-(--color-foreground)/15" />
        <h2 class="px-4 font-sans text-[11px] font-medium uppercase tracking-[0.3em] text-(--color-muted-foreground) sm:text-xs 3xl:text-sm 4xl:text-base">
          {{ t('statsPromo.eyebrow') }}
        </h2>
        <span aria-hidden="true" class="h-px flex-1 bg-(--color-foreground)/15" />
      </MarketingReveal>

      <ul
        role="list"
        class="mx-auto grid max-w-xl gap-3 sm:gap-4 md:max-w-none md:grid-cols-3 lg:max-w-5xl lg:gap-5 xl:gap-6 2xl:max-w-6xl 3xl:max-w-[92rem] 3xl:gap-8 4xl:max-w-[124rem] 4xl:gap-10"
      >
        <li
          v-for="(item, i) in items"
          :key="item.kind"
          :ref="(el) => setTile(i, el)"
          class="stat-tile"
          :data-parked="parked[i] || undefined"
          :data-count-parked="countParked[i] || undefined"
          :style="{ '--d': `${delays[i]}ms`, '--dc': `${countDelays[i]}ms` }"
        >
          <motion.div
            :while-hover="{ y: -4 }"
            :transition="SPRING.default"
            class="press group/stat relative h-full [--press-scale:0.985] motion-reduce:transform-none!"
          >
            <!-- Depth: a deeper shadow fades in under the lifted tile.
                 Same box as the tile: an outer shadow is never painted
                 under its own box, so none of it shows through the glass. -->
            <div
              aria-hidden="true"
              class="pointer-events-none absolute inset-0 -z-10 rounded-(--radius-xl) opacity-0 shadow-(--shadow-lift) transition-opacity duration-(--spring-default) ease-(--ease-spring) group-hover/stat:opacity-100"
            />

            <div
              class="stat-glass relative flex h-full items-center gap-4 overflow-hidden rounded-(--radius-xl) p-4 sm:gap-6 sm:p-5 md:flex-col md:items-stretch md:gap-0 md:p-5 lg:p-7 xl:p-8 3xl:p-10 4xl:p-14 [@media(max-height:30rem)]:flex-row! [@media(max-height:30rem)]:items-center! [@media(max-height:30rem)]:gap-4! [@media(max-height:30rem)]:p-4!"
            >
              <!-- The picture. Its font-size is the unit every part of
                   it is drawn in, so it scales as one piece. -->
              <div
                aria-hidden="true"
                class="stat-stage relative isolate grid h-[11em] w-[11em] shrink-0 place-items-center text-[9px] sm:text-[10px] md:w-full md:text-[11px] lg:text-[12.5px] xl:text-[13.5px] 2xl:text-[14.5px] 3xl:text-[17.5px] 4xl:text-[23px] [@media(max-height:30rem)]:w-[11em]! [@media(max-height:30rem)]:text-[8px]!"
                :data-kind="item.kind"
              >
                <!-- 50 · photos landing on a stack -->
                <template v-if="item.kind === 'photos'">
                  <div
                    v-for="(card, k) in DECK"
                    :key="card.name"
                    class="stat-card col-start-1 row-start-1 aspect-[3/4] w-[6.2em] rounded-[0.55em] bg-white p-[0.24em]"
                    :style="{ '--x': `${card.x}em`, '--y': `${card.y}em`, '--r': `${card.r}deg`, '--k': k }"
                  >
                    <MarketingPhoto :name="card.name" :sizes="DECK_SIZES" class="h-full w-full rounded-[0.32em] object-cover" />
                  </div>
                </template>

                <!-- 15 · a round video message recording -->
                <div v-else-if="item.kind === 'video'" class="relative col-start-1 row-start-1 grid h-[9.8em] w-[9.8em] place-items-center">
                  <svg viewBox="0 0 100 100" fill="none" class="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="50" cy="50" r="47" stroke-width="3" class="stat-track" />
                    <circle cx="50" cy="50" r="47" stroke-width="3.4" stroke-linecap="round" pathLength="1" class="stat-rec-arc" />
                  </svg>
                  <div class="stat-selfie h-[8.3em] w-[8.3em] overflow-hidden rounded-full bg-(--color-accent)">
                    <MarketingPhoto
                      name="mock-video-selfie"
                      :sizes="SELFIE_SIZES"
                      position="center 28%"
                      class="h-full w-full object-cover"
                    />
                  </div>
                  <span
                    class="absolute -bottom-[0.35em] left-1/2 flex -translate-x-1/2 items-center gap-[0.45em] rounded-full bg-white/90 px-[0.75em] py-[0.3em] text-[1.1em] font-semibold leading-none tabular-nums text-(--color-foreground) shadow-(--shadow-soft)"
                  >
                    <span class="stat-rec-dot block h-[0.55em] w-[0.55em] rounded-full" />
                    <span class="grid">
                      <span class="stat-timer-final col-start-1 row-start-1">0:15</span>
                      <span class="stat-timer col-start-1 row-start-1" />
                    </span>
                  </span>
                </div>

                <!-- 12 · a year dial, month by month -->
                <div v-else class="relative col-start-1 row-start-1 grid h-[9.8em] w-[9.8em] place-items-center">
                  <svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-width="6.5" class="absolute inset-0 h-full w-full">
                    <path v-for="(m, k) in MONTHS" :key="`t${k}`" :d="m.d" class="stat-track" />
                    <path
                      v-for="(m, k) in MONTHS"
                      :key="`m${k}`"
                      :d="m.d"
                      :stroke="m.color"
                      class="stat-month"
                      :style="{ '--m': k }"
                    />
                  </svg>
                  <div class="stat-hub grid h-[4.8em] w-[4.8em] place-items-center rounded-full">
                    <FolderHeart class="h-[2.1em] w-[2.1em] text-(--color-primary)" :stroke-width="1.5" />
                  </div>
                </div>
              </div>

              <!-- The number. Screen readers get the whole phrase once;
                   the counting digits are hidden from them. -->
              <div class="min-w-0 flex-1 md:mt-5 md:flex-none md:text-center 3xl:mt-7 4xl:mt-9 [@media(max-height:30rem)]:mt-0! [@media(max-height:30rem)]:flex-1! [@media(max-height:30rem)]:text-left!">
                <p class="sr-only">{{ item.spoken }}</p>
                <div aria-hidden="true">
                  <span
                    v-if="item.prefix"
                    class="block font-display text-xl italic leading-none text-(--color-primary) lg:text-2xl 2xl:text-[1.75rem] 3xl:text-[2.1rem] 4xl:text-[2.75rem]"
                  >{{ item.prefix }}</span>
                  <span class="flex items-baseline gap-2 md:justify-center 3xl:gap-3 [@media(max-height:30rem)]:justify-start!">
                    <span
                      :ref="(el) => setDigits(i, el)"
                      class="stat-digits grid font-display text-[3.75rem] font-medium leading-[0.95] tracking-[-0.02em] lining-nums tabular-nums sm:text-[4.25rem] md:text-[4.5rem] lg:text-[5.25rem] xl:text-[6rem] 2xl:text-[6.75rem] 3xl:text-[8.25rem] 4xl:text-[11rem] [@media(max-height:30rem)]:text-[3.5rem]!"
                    >
                      <span class="stat-final col-start-1 row-start-1 text-gradient-gold">{{ item.value }}</span>
                      <span class="stat-count col-start-1 row-start-1 text-gradient-gold" :style="{ '--to': item.value }" />
                    </span>
                    <span
                      v-if="item.suffix"
                      class="font-display text-xl italic leading-none text-(--color-primary) lg:text-2xl 2xl:text-[1.75rem] 3xl:text-[2.1rem] 4xl:text-[2.75rem]"
                    >{{ item.suffix }}</span>
                  </span>
                  <span
                    class="mt-2 block text-pretty text-sm leading-snug text-(--color-muted-foreground) lg:mt-3 lg:text-[0.95rem] 2xl:text-base 3xl:text-lg 4xl:mt-4 4xl:text-2xl"
                  >{{ item.label }}</span>
                </div>
              </div>
            </div>
          </motion.div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
/* The tile's timelines. Registered so they interpolate (an unregistered
 * custom property would flip from 0 to 1 halfway). */
@property --stat-p {
  syntax: '<number>';
  inherits: true;
  initial-value: 1;
}
@property --stat-c {
  syntax: '<number>';
  inherits: true;
  initial-value: 1;
}
@property --stat-n {
  syntax: '<integer>';
  inherits: false;
  initial-value: 0;
}

/* ── Material ─────────────────────────────────────────────────────── */
.stat-glass {
  background:
    radial-gradient(120% 75% at 50% 0%, oklch(99.5% 0.012 80 / 0.8), transparent 70%),
    linear-gradient(180deg, oklch(98.8% 0.012 75 / 0.78), oklch(97.2% 0.022 62 / 0.64));
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
  border: 1px solid oklch(100% 0 0 / 0.6);
  box-shadow:
    inset 0 1px 0 oklch(100% 0 0 / 0.75),
    0 1px 2px rgb(0 0 0 / 0.04),
    0 18px 40px -24px rgb(160 110 90 / 0.4);
}
@media (prefers-reduced-transparency: reduce) {
  .stat-glass {
    background: oklch(97.5% 0.018 68);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
.stat-track { stroke: oklch(86% 0.03 60 / 0.55); }
.stat-hub {
  background: oklch(99% 0.012 75 / 0.75);
  box-shadow: inset 0 0 0 1px oklch(90% 0.03 65 / 0.8), 0 0.5em 1.2em -0.6em rgb(160 110 90 / 0.45);
  transition: scale var(--spring-default) var(--ease-spring);
}
/* A soft pool of light behind each picture, tinted by what it shows:
 * gold under the photos, rose under the recording, champagne under
 * the year. It gathers with the count. (The stage is isolated, so
 * z-index -1 lands above the glass, below the picture.) */
.stat-stage::before {
  content: '';
  position: absolute;
  inset: -4% 6%;
  z-index: -1;
  border-radius: 50%;
  background: radial-gradient(closest-side, var(--glow), transparent);
  opacity: var(--stat-p);
  scale: calc(0.7 + 0.3 * var(--stat-p));
  pointer-events: none;
}
.stat-stage[data-kind='photos'] { --glow: oklch(86% 0.1 72 / 0.75); }
.stat-stage[data-kind='video'] { --glow: oklch(83% 0.09 20 / 0.6); }
.stat-stage[data-kind='archive'] { --glow: oklch(89% 0.085 85 / 0.8); }

/* ── Entrance: the tile settles in, then its timeline runs ─────────── */
.stat-tile {
  --stat-p: 1;
  animation:
    stat-rise var(--spring-gentle) var(--ease-spring) both,
    stat-run 1400ms var(--ease-spring) both;
  animation-delay: var(--d, 0ms), calc(var(--d, 0ms) + 140ms);
}
@keyframes stat-rise {
  from { opacity: 0; translate: 0 18px; }
}
@keyframes stat-run {
  from { --stat-p: 0; }
  to { --stat-p: 1; }
}
/* The count: its own clock, so it can wait for its digits to be seen. */
.stat-digits {
  animation: stat-tally 1400ms var(--ease-spring) both;
  animation-delay: var(--dc, 140ms);
}
@keyframes stat-tally {
  from { --stat-c: 0; }
  to { --stat-c: 1; }
}

/* 50 · each photo is dealt onto the stack on its own spring. It is a
 * solid print within a frame or two (a 100 ms fade of its own),
 * so the cards never ghost through each other while they fly in. */
.stat-card {
  translate: var(--x) var(--y);
  rotate: var(--r);
  box-shadow: 0 0.5em 1.1em -0.55em oklch(35% 0.06 40 / 0.55), 0 0 0 0.5px oklch(80% 0.03 60 / 0.6);
  animation:
    stat-deal 600ms var(--ease-spring) both,
    stat-deal-in 100ms var(--ease-out-soft) both;
  animation-delay: calc(var(--d, 0ms) + 160ms + var(--k) * 110ms);
  transition: transform var(--spring-default) var(--ease-spring);
}
@keyframes stat-deal {
  from {
    translate: calc(var(--x) + 2.4em) calc(var(--y) - 2.8em);
    rotate: calc(var(--r) + 16deg);
    scale: 1.1;
  }
}
@keyframes stat-deal-in {
  from { opacity: 0; }
}

/* 15 · the recording ring fills with the count. */
.stat-rec-arc {
  stroke: oklch(62% 0.17 27);
  stroke-dasharray: 1 1;
  stroke-dashoffset: calc(1 - var(--stat-p));
  opacity: clamp(0, calc(var(--stat-p) * 40), 1);
}
.stat-rec-dot {
  background: oklch(62% 0.19 27);
  /* Blinks while the ring records, then holds: the clip is done. */
  animation: stat-blink 700ms ease-in-out 2 both;
  animation-delay: calc(var(--d, 0ms) + 140ms);
}
@keyframes stat-blink {
  50% { opacity: 0.25; }
}
.stat-selfie { transition: transform var(--spring-default) var(--ease-spring); }

/* 12 · segment k lights up as the count passes month k + 1. */
.stat-month { opacity: clamp(0, calc((var(--stat-p) * 12 - var(--m)) * 2), 1); }

/* Hover (pointer devices): the stack fans out a little, the video
 * leans in, the archive's hub rises. */
@media (hover: hover) {
  .group\/stat:hover .stat-card {
    transform: translate(calc(var(--x) * 0.5), calc(var(--y) * 0.5 - 0.15em)) rotate(calc(var(--r) * 0.6));
  }
  .group\/stat:hover .stat-selfie { transform: scale(1.04); }
  .group\/stat:hover .stat-hub { scale: 1.06; }
}

/* ── The count ─────────────────────────────────────────────────────── */
/* A CSS counter tied to --stat-c. Only where @property is known to be
 * supported (every engine with allow-discrete transitions has it);
 * elsewhere the real number stays visible. The final value keeps its
 * cell, so the width never changes while counting, and the text's
 * start edge never moves — no layout shift is recorded. On a phone
 * (and on a short screen) the column is left-aligned, so the count
 * starts at that edge, in line with «до» and the caption. Centred
 * (md+, taller than 30rem — the short-screen breakpoint), it fills the cell
 * right to left (rtl: the digits are still read 1-0), so the units
 * digit stays put when the tens appear. */
.stat-count,
.stat-timer { display: none; }
@supports (transition-behavior: allow-discrete) {
  .stat-final,
  .stat-timer-final { visibility: hidden; }
  .stat-count { display: block; text-align: start; }
  .stat-count::before {
    --stat-n: calc(var(--stat-c) * var(--to));
    counter-reset: stat-n var(--stat-n);
    content: counter(stat-n);
  }
  .stat-timer { display: block; }
  @media (min-width: 768px) and (min-height: 30.0625rem) {
    .stat-count { direction: rtl; }
  }
  .stat-timer::before {
    --stat-n: calc(var(--stat-p) * 15);
    counter-reset: stat-n var(--stat-n);
    content: '0:' counter(stat-n, decimal-leading-zero);
  }
}

/* ── Parked below the fold: every animation off, first frame shown ── */
.stat-tile[data-parked],
.stat-tile[data-parked] * { animation: none !important; }
.stat-tile[data-parked] {
  --stat-p: 0;
  opacity: 0;
  translate: 0 18px;
}
.stat-tile[data-parked] .stat-card { opacity: 0; }
/* The count waits for its digits: held at 0. */
.stat-tile[data-count-parked] .stat-digits { animation: none !important; }
.stat-tile[data-count-parked] { --stat-c: 0; }

/* Reduced motion: the final state, at once. */
@media (prefers-reduced-motion: reduce) {
  .stat-tile,
  .stat-tile * { animation: none !important; }
}
</style>
