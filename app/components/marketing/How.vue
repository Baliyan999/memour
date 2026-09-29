<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from '#imports'
import { motion, motionValue, animate, inView, useScroll, useSpring, useTransform, useMotionValueEvent } from 'motion-v'
import { Check } from '@lucide/vue'
import { SPRING, usePrefersReducedMotion, useReveal } from '~/composables/useMotion'
import HowSceneTable from './HowSceneTable.vue'
import HowScenePhone from './HowScenePhone.vue'
import HowSceneAlbum from './HowSceneAlbum.vue'

/**
 * How — the three steps as a scroll story that shows the product:
 * the table card with its QR, the guest page on a phone, the couple's
 * album with the ZIP download. Each step owns one scene (HowScene*),
 * driven by a 0→1 timeline.
 *
 * Desktop (lg+, motion allowed): the step texts scroll on the left
 * along a rail that runs through their numerals; on the right a sticky
 * stage holds all three scenes. The rail fills up to the middle of the
 * screen; when a step takes the middle its text, its numeral and the
 * stage switch to it together (the scene we pass grows and fades, the
 * next one arrives from slightly behind — and back the same way).
 * A scene plays once its step takes the stage (the first one once the
 * stage is well in view): its timeline runs to the end on its own
 * clock, at the pace of the phone cards, so a reader who stops right
 * after a hand-over sees it build instead of an empty first frame (a
 * blank QR, an album of placeholders). It stays played when scrolled
 * back past.
 *
 * Phones and tablets: a native scroll-snap carousel of cards, each with
 * its own scene, played once when the card comes into view. One dot per
 * place the scroller can rest at (a card each on phones, two pages of
 * two cards on tablets); the dot pill tracks the swipe 1:1 and a tap on
 * a dot scrolls there. The dots only appear once they work (after mount).
 *
 * SSR, no JS and reduced motion get the static layout: every step with
 * its scene in its final frame (timelines at 1). The desktop stage and
 * rail only mount on the client, are absolutely positioned and share
 * the rows' geometry, so bringing them in shifts nothing.
 */
const SCENES = [HowSceneTable, HowScenePhone, HowSceneAlbum] as const
const COUNT = SCENES.length

const { t } = useI18n()
const reduce = usePrefersReducedMotion()

const titleWords = computed(() => t('how.title').split(' '))
const steps = computed(() =>
  SCENES.map((_, i) => ({
    numeral: String(i + 1).padStart(2, '0'),
    title: t(`how.step${i + 1}Title`),
    desc: t(`how.step${i + 1}Desc`),
    note: t(`how.step${i + 1}Note`),
    label: t(`how.stage.label${i + 1}`),
  })),
)

// ── Layout mode ────────────────────────────────────────────────────
const mounted = ref(false)
const isMd = ref(false)
const isLg = ref(false)
const enhanced = computed(() => isLg.value && !reduce.value)
let mdQuery: MediaQueryList | undefined
let lgQuery: MediaQueryList | undefined
const syncMd = () => { isMd.value = !!mdQuery?.matches; measure() }
const syncLg = () => { isLg.value = !!lgQuery?.matches }
const onLgChange = () => { syncLg(); measure() }

// ── Desktop: scroll story ──────────────────────────────────────────
const listRef = ref<HTMLElement | null>(null)
const numeralEls: HTMLElement[] = []
const { scrollYProgress } = useScroll({ target: listRef, offset: ['start center', 'end center'] })
// ζ = 1 (damping = 2·√stiffness), response ≈ 0.3 s — smooths wheel steps, never overshoots.
const progress = useSpring(scrollYProgress, { stiffness: 400, damping: 40, mass: 1 })

/**
 * Measured on the client (lg), px from the top of the list:
 *  lift    — how far the reading line sits below the middle of the
 *            screen (half the fixed header, so it's the middle of what's visible)
 *  anchors — the middle of each step: where its text and the stage line up
 *  stops   — the middle of each numeral, where the rail passes through
 *  gap     — how far the rail keeps clear of a numeral
 */
const geo = { length: 0, lift: 0, anchors: [] as number[], stops: [] as number[], gap: 0 }
const rail = ref<{ x: number; segments: { top: number; height: number }[] } | null>(null)

const active = ref(0)
const stageTimelines = SCENES.map(() => motionValue(0))
// Static default (SSR, reduced motion): rail full.
const fills = SCENES.slice(1).map(() => motionValue(1))
const headY = motionValue(0)
const headOpacity = motionValue(0)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * A triggered scene plays its whole timeline in PLAY_TIME (the phone
 * cards' duration), so its beats (the tap, the flash, the print) come
 * after it has faded in and it finishes wherever the scroll stops.
 */
const PLAY_TIME = 2.2 // s
const stageTargets = SCENES.map(() => 0)
let paceAt = 0
let paceFrame = 0
function pace() {
  const now = performance.now()
  const step = paceAt ? Math.min(now - paceAt, 64) / 1000 / PLAY_TIME : 0
  paceAt = now
  let behind = false
  stageTimelines.forEach((timeline, i) => {
    const at = timeline.get()
    const to = stageTargets[i]!
    const next = to < at ? to : Math.min(to, at + step)
    if (next !== at) timeline.set(next)
    if (next < to) behind = true
  })
  if (!behind) paceAt = 0
  else if (!paceFrame) paceFrame = requestAnimationFrame(() => { paceFrame = 0; pace() })
}

// One pass per frame of the smoothed progress; only motion values are
// written, so the rail and scenes move on transform/opacity.
function update() {
  const { length, lift, anchors, stops, gap } = geo
  if (!length || !enhanced.value) return
  const head = progress.get() * length + lift

  let nearest = 0
  anchors.forEach((y, i) => { if (Math.abs(head - y) < Math.abs(head - anchors[nearest]!)) nearest = i })
  if (nearest !== active.value) active.value = nearest

  // A scene is let go at its hand-over — the first one half a step
  // earlier, when about a quarter of the stage is in view — and plays
  // to the end (see pace). Targets only ever rise.
  anchors.forEach((y, i) => {
    const half = (i > 0 ? y - anchors[i - 1]! : anchors[1]! - anchors[0]!) / 2
    if (head >= y - half * (i > 0 ? 1 : 1.5)) stageTargets[i] = 1
  })
  pace()

  let glow = 0
  fills.forEach((fill, k) => {
    const top = stops[k]! + gap
    const bottom = stops[k + 1]! - gap
    fill.set(clamp01((head - top) / (bottom - top)))
    if (head > top && head < bottom) glow = Math.min(1, (head - top) / 32, (bottom - head) / 32)
  })
  headY.set(Math.min(Math.max(head, stops[0]!), stops[COUNT - 1]!))
  headOpacity.set(glow)
}
useMotionValueEvent(progress, 'change', update)

function measure() {
  measureCarousel()
  const list = listRef.value
  if (!list || !isLg.value || numeralEls.length < COUNT) {
    rail.value = null
    geo.length = 0
    return
  }
  const box = list.getBoundingClientRect()
  const rows = Array.from(list.children) as HTMLElement[]
  const pad = parseFloat(getComputedStyle(rows[0]!).paddingTop) || 0
  const marks = numeralEls.map((el) => el.getBoundingClientRect())
  geo.length = box.height
  geo.lift = pad / 2
  geo.anchors = rows.map((row) => row.offsetTop + pad + (row.offsetHeight - pad) / 2)
  // Old-style figures sit low in their box: aim at the ink, not the box.
  geo.stops = marks.map((r) => r.top - box.top + r.height * 0.6)
  geo.gap = marks[0]!.height * 0.5 + 10
  rail.value = {
    x: marks[0]!.left - box.left + marks[0]!.width / 2,
    segments: fills.map((_, k) => ({
      top: geo.stops[k]! + geo.gap,
      height: Math.max(0, geo.stops[k + 1]! - geo.stops[k]! - 2 * geo.gap),
    })),
  }
  update()
}

watch(enhanced, (on) => {
  if (on) return measure()
  fills.forEach((v) => v.set(1))
  headOpacity.set(0)
})

// The step we're on is at full strength, the others recede. Numerals
// light up with their step and stay lit once passed, like the rail.
const dimmed = (i: number) => enhanced.value && active.value !== i
const unlit = (i: number) => enhanced.value && i > active.value

// Hand-over: the scene we scroll past grows and fades (we move through
// it), the next one arrives from slightly behind. Reversible. The
// leaving scene clears out quicker than the arriving one settles, so
// the two busy screens barely overlap; in between the stage's warm
// ground shows, not the page.
function sceneState(i: number) {
  if (i === active.value) return { opacity: 1, scale: 1, transition: { ...SPRING.gentle, opacity: SPRING.default } }
  return { opacity: 0, scale: i < active.value ? 1.08 : 0.94, transition: { ...SPRING.gentle, opacity: SPRING.snappy } }
}
// The tab's numeral and name roll the way the page scrolls.
function tabState(i: number) {
  return { opacity: i === active.value ? 1 : 0, y: i === active.value ? '0%' : i < active.value ? '-100%' : '100%' }
}

// ── Phones / tablets: carousel ─────────────────────────────────────
const { scrollX, scrollXProgress } = useScroll({ container: listRef })
const DOT_PITCH = 44 // px — w-11 dot buttons, a full 44 px touch target each

/**
 * Where the scroller can actually come to rest, px — one dot each.
 * Phones centre each card (the first and last clamp to the ends, the
 * middle one sits at exactly half way): three stops. Tablets show two
 * cards and align them to the start, so the 2nd and 3rd card share the
 * end: two stops. `dots` holds the first card of each stop.
 */
const cardEls: HTMLElement[] = []
let stops: number[] = []
const dots = ref(SCENES.map((_, i) => i))
const carouselIndex = ref(0)
const indicatorX = motionValue(0)

function measureCarousel() {
  const scroller = listRef.value
  if (!scroller || isLg.value || cardEls.length < COUNT) return
  const max = scroller.scrollWidth - scroller.clientWidth
  const pad = parseFloat(getComputedStyle(scroller).scrollPaddingLeft) || 0
  const next: number[] = []
  const first: number[] = []
  cardEls.forEach((card, i) => {
    const left = getComputedStyle(card).scrollSnapAlign.includes('center')
      ? card.offsetLeft + card.offsetWidth / 2 - scroller.clientWidth / 2
      : card.offsetLeft - pad
    const stop = Math.round(Math.min(Math.max(left, 0), max))
    if (next.length && stop - next.at(-1)! < 2) return
    next.push(stop)
    first.push(i)
  })
  stops = next
  if (first.join() !== dots.value.join()) dots.value = first
  syncCarousel(scrollX.get())
}

// The pill runs piecewise between the stops, so it sits exactly on a
// dot wherever the scroller rests; the current dot is the nearest stop.
function syncCarousel(x: number) {
  if (stops.length < 2 || !Number.isFinite(x)) return
  let k = 0
  while (k < stops.length - 2 && x > stops[k + 1]!) k++
  const span = stops[k + 1]! - stops[k]!
  const f = span > 0 ? clamp01((x - stops[k]!) / span) : 0
  indicatorX.set((k + f) * DOT_PITCH)
  carouselIndex.value = f < 0.5 ? k : k + 1
}
useMotionValueEvent(scrollX, 'change', syncCarousel)

function goTo(k: number) {
  const scroller = listRef.value
  const left = stops[k]
  if (!scroller || left === undefined) return
  scroller.scrollTo({ left, behavior: reduce.value ? 'auto' : 'smooth' })
}

// Phones: cards away from the centre recede a little while swiping
// (tablets show two cards at once, both at full strength). One stop
// per card, spanning exactly [0, 1] — centred cards rest at 0, ½ and 1:
// motion hands scroll-linked transforms to a native ScrollTimeline,
// whose keyframe offsets must stay inside [0, 1] and cover it, or the
// held value drifts.
const CARD_STOPS = SCENES.map((_, i) => i / (COUNT - 1))
const cardFocus = SCENES.map((_, i) => useTransform(scrollXProgress, CARD_STOPS, CARD_STOPS.map((_, j) => (j === i ? 1 : 0.55))))
const focusOn = computed(() => mounted.value && !isMd.value && !reduce.value)

// Card scenes start at their final frame (SSR, reduced motion); cards
// still out of view when JS arrives rewind and play when they appear.
const cardTimelines = SCENES.map(() => motionValue(1))

const cardWatchers: VoidFunction[] = []
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  mounted.value = true
  lgQuery = window.matchMedia('(min-width: 64rem)')
  syncLg()
  lgQuery.addEventListener('change', onLgChange)
  mdQuery = window.matchMedia('(min-width: 48rem)')
  syncMd()
  mdQuery.addEventListener('change', syncMd)

  // Rows keep their height, but fonts and resizes move the numerals.
  resizeObserver = new ResizeObserver(() => measure())
  if (listRef.value) {
    resizeObserver.observe(listRef.value)
    numeralEls.forEach((el) => resizeObserver!.observe(el.parentElement ?? el))
  }
  document.fonts?.ready.then(measure)
  measure()

  if (isLg.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  cardEls.forEach((card, i) => {
    const r = card.getBoundingClientRect()
    const seenX = (Math.min(r.right, window.innerWidth) - Math.max(r.left, 0)) / r.width
    const seenY = (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / r.height
    if (seenX > 0.5 && seenY > 0.3) return
    const timeline = cardTimelines[i]!
    timeline.set(0)
    const stop = inView(card, () => {
      animate(timeline, 1, { duration: 2.2, ease: 'linear' })
      stop()
    }, { amount: 0.55 })
    cardWatchers.push(stop)
  })
})
onBeforeUnmount(() => {
  cancelAnimationFrame(paceFrame)
  mdQuery?.removeEventListener('change', syncMd)
  lgQuery?.removeEventListener('change', onLgChange)
  resizeObserver?.disconnect()
  cardWatchers.forEach((stop) => stop())
})

const headRef = ref<HTMLElement | null>(null)
useReveal(headRef, { items: '[data-reveal]', stagger: 0.05, y: 22 })
</script>

<template>
  <section id="how" class="relative overflow-x-clip py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10">
    <MarketingFloatingOrnaments :count="10" :hue-base="25" :hue-spread="70" />

    <div class="container-page relative">
      <div ref="headRef" class="mx-auto mb-8 max-w-2xl text-center md:mb-10 lg:mb-0 3xl:max-w-4xl">
        <p data-reveal aria-hidden="true" class="mb-3 text-[10px] uppercase tracking-[0.3em] text-(--color-primary) sm:text-xs">
          ⋄ ⋄ ⋄
        </p>
        <h2 class="heading-display-lg text-balance">
          <template v-for="(w, i) in titleWords" :key="i">
            <span data-reveal class="inline-block">{{ w }}</span>{{ i < titleWords.length - 1 ? ' ' : '' }}
          </template>
        </h2>
        <p data-reveal class="mx-auto mt-4 max-w-xl text-pretty text-(--color-muted-foreground) md:text-lg 3xl:max-w-2xl 3xl:text-xl">
          {{ t('how.subtitle') }}
        </p>
      </div>

      <!-- Geometry (lg), variables in .how-story: a row is the header
           clearance (--how-h) plus an --how-s area where the text sits
           centred beside its scene. The sticky stage box is --how-s tall
           and sticks with its middle at the middle of the visible screen,
           so it pins as step 1 lines up with it and lets go as step 3 does. -->
      <div class="how-story relative mx-auto max-w-[80rem] 3xl:max-w-[100rem]">
        <!-- Steps: a snap carousel below lg, rows of [text | scene] from lg -->
        <ol
          ref="listRef"
          class="relative -mx-5 -my-4 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-px-5 px-5 py-4 [scrollbar-width:none] md:gap-5 [&::-webkit-scrollbar]:hidden lg:mx-0 lg:my-0 lg:block lg:overflow-visible lg:p-0"
        >
          <motion.li
            v-for="(step, i) in steps"
            :key="i"
            :ref="(el: unknown) => { if (el) cardEls[i] = ((el as { $el?: HTMLElement }).$el ?? el) as HTMLElement }"
            class="flex w-[86%] shrink-0 snap-center flex-col overflow-hidden rounded-[2rem] bg-[oklch(98.6%_0.012_70/0.86)] shadow-(--shadow-soft) ring-1 ring-white/70 md:w-[46%] md:snap-start lg:grid lg:min-h-(--how-row) lg:w-auto lg:grid-cols-2 lg:gap-x-(--how-gap) lg:overflow-visible lg:rounded-none lg:bg-transparent lg:pt-(--how-h) lg:shadow-none lg:ring-0"
            :style="focusOn ? { opacity: cardFocus[i] } : undefined"
          >
            <!-- Text -->
            <div class="px-5 pb-6 pt-5 sm:px-6 lg:flex lg:items-center lg:p-0">
              <div class="lg:grid lg:grid-cols-[var(--how-rail)_minmax(0,1fr)] lg:gap-x-5 3xl:gap-x-7">
                <!-- lg: the numeral is a stop on the rail, on the title's baseline -->
                <span
                  :ref="(el: unknown) => { if (el) numeralEls[i] = el as HTMLElement }"
                  aria-hidden="true"
                  class="relative hidden justify-self-center font-display text-[5rem] font-medium italic leading-none lg:col-start-1 lg:row-start-1 lg:block lg:self-baseline 3xl:text-[6.5rem]"
                >
                  <span class="text-(--color-foreground)/20">{{ step.numeral }}</span>
                  <span class="numeral-lit absolute inset-0" :class="{ 'is-unlit': unlit(i) }">{{ step.numeral }}</span>
                </span>
                <div class="flex items-center gap-3 lg:hidden" aria-hidden="true">
                  <span class="numeral-lit font-display text-[2.75rem] font-medium italic leading-none">{{ step.numeral }}</span>
                  <span class="h-px flex-1 bg-gradient-to-r from-(--color-primary)/35 to-transparent" />
                </div>
                <h3
                  class="how-dim heading-display-md mt-2 text-balance lg:col-start-2 lg:row-start-1 lg:mt-0 lg:self-baseline lg:text-[clamp(2.25rem,4vw,5rem)]"
                  :class="{ 'is-dimmed': dimmed(i) }"
                >
                  <span class="sr-only">{{ i + 1 }}. </span>{{ step.title }}
                </h3>
                <p
                  class="how-dim mt-2.5 text-pretty text-(--color-muted-foreground) lg:col-start-2 lg:mt-4 lg:max-w-[34rem] lg:text-lg 3xl:max-w-[40rem] 3xl:text-xl"
                  :class="{ 'is-dimmed': dimmed(i) }"
                >
                  {{ step.desc }}
                </p>
                <p
                  class="how-dim mt-4 inline-flex items-center gap-2 rounded-full border border-(--color-primary)/20 bg-white/60 py-1.5 pl-1.5 pr-3.5 text-xs font-medium text-(--color-primary) lg:col-start-2 lg:mt-6 lg:justify-self-start lg:text-sm 3xl:text-base"
                  :class="{ 'is-dimmed': dimmed(i) }"
                >
                  <span class="grid h-5 w-5 place-items-center rounded-full bg-(--color-primary) text-(--color-primary-foreground) 3xl:h-6 3xl:w-6">
                    <Check class="h-3 w-3 3xl:h-3.5 3xl:w-3.5" :stroke-width="3" />
                  </span>
                  {{ step.note }}
                </p>
              </div>
            </div>

            <!-- Scene: the card's picture on phones (room on top for the
                 tab), the row's picture on desktop (faded out once the
                 sticky stage is up). -->
            <div
              class="order-first p-2.5 pt-5 transition-opacity duration-500 lg:order-none lg:flex lg:items-center lg:justify-center lg:p-0"
              :class="enhanced ? 'lg:opacity-0' : ''"
            >
              <div class="relative w-full lg:w-(--how-frame)">
                <div class="relative aspect-[4/5] overflow-hidden rounded-[1.5rem] lg:rounded-[2.25rem] lg:shadow-(--shadow-lift)">
                  <component :is="SCENES[i]" :timeline="cardTimelines[i]!" />
                  <span class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/30" />
                </div>
                <span aria-hidden="true" class="how-tab">
                  <span class="font-display text-base italic text-(--color-primary)">{{ step.numeral }}</span>
                  <span class="h-3.5 w-px bg-(--color-border)" />
                  {{ step.label }}
                </span>
              </div>
            </div>
          </motion.li>
        </ol>

        <!-- Rail (lg, client): runs through the numerals and fills up to
             the reading line; a diamond rides the tip between stops. -->
        <div v-if="rail" aria-hidden="true" class="pointer-events-none absolute inset-0 hidden lg:block">
          <span
            v-for="(segment, k) in rail.segments"
            :key="k"
            class="absolute w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-(--color-foreground)/10"
            :style="{ left: `${rail.x}px`, top: `${segment.top}px`, height: `${segment.height}px` }"
          >
            <motion.span
              class="block h-full w-full origin-top rounded-full bg-gradient-to-b from-(--color-rose) to-(--color-primary)"
              :style="{ scaleY: fills[k] }"
            />
          </span>
          <motion.span class="absolute left-0 top-0" :style="{ x: rail.x, y: headY, opacity: headOpacity }">
            <span class="absolute block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-(--color-primary) bg-white shadow-[0_0_14px_3px_oklch(84%_0.07_55/0.8)]" />
          </motion.span>
        </div>

        <!-- Desktop sticky stage (client only, motion allowed) -->
        <div
          v-if="enhanced"
          aria-hidden="true"
          class="pointer-events-none absolute bottom-0 right-0 top-(--how-h) hidden w-[calc(50%-var(--how-gap)/2)] lg:block"
        >
          <div class="sticky top-(--how-stick) flex h-(--how-s) items-center justify-center">
            <motion.div
              class="relative w-(--how-frame)"
              :initial="{ opacity: 0 }"
              :animate="{ opacity: 1 }"
              :transition="SPRING.gentle"
            >
              <!-- Opaque warm ground: mid hand-over both scenes are half
                   transparent, and the page's peach must not wash through. -->
              <div class="relative aspect-[4/5] overflow-hidden rounded-[2.25rem] bg-[oklch(34%_0.045_50)] shadow-(--shadow-lift)">
                <motion.div
                  v-for="(Scene, i) in SCENES"
                  :key="i"
                  class="absolute inset-0"
                  :initial="false"
                  :animate="sceneState(i)"
                  :transition="SPRING.gentle"
                >
                  <component :is="Scene" :timeline="stageTimelines[i]!" />
                </motion.div>
                <span class="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/30" />
              </div>

              <!-- Step tab: numeral and name roll with the hand-over -->
              <span class="how-tab">
                <span class="grid overflow-hidden font-display text-base italic text-(--color-primary)">
                  <motion.span
                    v-for="(step, i) in steps"
                    :key="i"
                    class="col-start-1 row-start-1"
                    :initial="false"
                    :animate="tabState(i)"
                    :transition="SPRING.default"
                  >{{ step.numeral }}</motion.span>
                </span>
                <span class="h-3.5 w-px bg-(--color-border)" />
                <span class="grid overflow-hidden">
                  <motion.span
                    v-for="(step, i) in steps"
                    :key="i"
                    class="col-start-1 row-start-1 whitespace-nowrap text-center"
                    :initial="false"
                    :animate="tabState(i)"
                    :transition="SPRING.default"
                  >{{ step.label }}</motion.span>
                </span>
              </span>
            </motion.div>
          </div>
        </div>
      </div>

      <!-- Carousel dots (below lg): the pill follows the swipe 1:1. Held
           invisible (space kept) until mount, when they start working. -->
      <div
        class="mt-4 flex justify-center transition-opacity duration-500 lg:hidden"
        :class="mounted ? 'opacity-100' : 'invisible opacity-0'"
      >
        <div class="relative isolate flex">
          <!-- A capsule in the cards' ivory holds the full-size touch
               targets together as one control (and keeps the section's
               floating ornaments from reading as extra dots). Behind the
               dots, which stay under the pill. -->
          <span aria-hidden="true" class="pointer-events-none absolute inset-x-2 inset-y-[11px] -z-10 rounded-full bg-[oklch(98.6%_0.012_70/0.94)] ring-1 ring-white/70" />
          <motion.span
            aria-hidden="true"
            class="pointer-events-none absolute left-3.5 top-1/2 -mt-[3px] h-1.5 w-4 rounded-full bg-(--color-primary)"
            :style="{ x: indicatorX }"
          />
          <button
            v-for="(card, k) in dots"
            :key="card"
            type="button"
            class="grid h-11 w-11 place-items-center"
            :aria-label="t('how.goTo', { n: card + 1 })"
            :aria-current="carouselIndex === k ? 'step' : undefined"
            @click="goTo(k)"
          >
            <span class="h-1.5 w-1.5 rounded-full bg-(--color-foreground)/30" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Scroll-story geometry (lg). --how-s: the stage box — tall, but never
 * wider than the column allows at 4:5 (+ the tab's clearance). */
.how-story {
  --how-h: 5.5rem;
  --how-gap: 2.5rem;
  --how-rail: 6rem;
  --how-s: min(76vh, 60rem, (50vw - 2rem - var(--how-gap) / 2) * 1.25 + 2rem);
  --how-row: calc(var(--how-s) + var(--how-h));
  --how-stick: calc(var(--how-h) + (100vh - var(--how-h) - var(--how-s)) / 2);
  --how-frame: min(100%, (var(--how-s) - 2rem) * 0.8);
}
@media (min-width: 80rem) {
  .how-story { --how-gap: 5rem; }
}
@media (min-width: 120rem) {
  .how-story { --how-gap: 7rem; --how-rail: 8rem; }
}

/* Steps off the reading line recede and numerals ahead stay unlit (lg,
 * motion allowed). CSS twin of SPRING.default, so a quick scroll back
 * retargets from where it is. */
.how-dim,
.numeral-lit {
  transition: opacity var(--spring-default) var(--ease-spring);
}
.how-dim.is-dimmed {
  opacity: 0.28;
}
.numeral-lit.is-unlit {
  opacity: 0;
}

/* Step numerals: a deeper cut of text-gradient-gold, so they hold up
 * on the peach backdrop. */
.numeral-lit {
  background: linear-gradient(135deg, oklch(47% 0.1 35), oklch(62% 0.1 50) 55%, oklch(50% 0.1 30));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* Step tab straddling the top edge of a scene frame. */
.how-tab {
  position: absolute;
  top: 0;
  left: 50%;
  translate: -50% -50%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 1rem 0.375rem 0.75rem;
  border-radius: 9999px;
  background: oklch(99% 0.008 75);
  box-shadow: var(--shadow-soft);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-foreground);
  white-space: nowrap;
}
</style>
