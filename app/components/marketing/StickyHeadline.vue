<script setup lang="ts">
import { ref, computed, defineComponent, h, watch, onMounted, onBeforeUnmount, type PropType } from 'vue'
import { useI18n } from '#imports'
import { Images } from '@lucide/vue'
import { motion, motionValue, animate, useScroll, useSpring, useTransform, useMotionValueEvent, easeInOut, easeOut, type MotionValue } from 'motion-v'
import { SPRING, usePrefersReducedMotion } from '~/composables/useMotion'
import MarketingPhoto from './Photo.vue'
import PHOTOS from './photo-manifest.json'

/**
 * StickyHeadline — three short phrases that hand over to each other as
 * the user scrolls past a pinned section: «Каждый кадр» (one photo),
 * «от каждого гостя» (a fan of five guests' shots), «в одном альбоме»
 * (the same shots gathered into one photo book). First phrase has no
 * enter, last has no exit so the section never shows a blank pinned
 * area. Pin window = 220vh.
 *
 * Choreography: scroll progress is followed by a critically damped
 * spring (smooths wheel steps, never overshoots). The visuals dissolve
 * across each phrase boundary, everything travelling upward — the way
 * the page scrolls — and reversing along the same path. Phrases 2 and
 * 3 share one stage: the fan opens as phrase 2 arrives, then the album
 * rises in behind the cards, the ones without a place of their own
 * slip into the spine and the rest fly onto the pages one after
 * another; while the section stays pinned the photos drift inside
 * their frames. Every card's pose is a pure function of the scroll, so
 * the motion scrubs both ways and never has to finish.
 * The lines and the book's fade are events instead: when the scroll
 * crosses a phrase boundary the old line leaves and the new one comes
 * in on their own springs (in sequence, they share a place), and the
 * book fades in (or out) as the scroll passes its mark. A stop
 * mid-scroll never holds a half-faded line, a screen with no line, or
 * a half-transparent book (which reads as a glass panel).
 * Photos of a phrase are only rendered once the scroll gets close to
 * it.
 *
 * The album is an open photo book on tablets and desktops and a single
 * page on phones (< 40rem), laid out in % of a fixed-ratio stage, so
 * the cards' poses stay in proportion at every width.
 *
 * Reduced motion: no pin, no scrub — the three phrases simply stack,
 * each with its own static visual (pure CSS via motion-reduce:, so it
 * holds before hydration too). Without JavaScript nothing would scrub
 * the phrases in, so noscript: gets the same static stack, with the
 * photos that never mount drawn as CSS backgrounds (see NOJS_PHOTO).
 */
const { t } = useI18n()
const reduce = usePrefersReducedMotion()

type PhotoName = keyof typeof PHOTOS
type Layout = 'page' | 'book'
type Tier = 'center' | 'inner' | 'outer'

const TOTAL = 3
const SPAN = 1 / TOTAL
// Length of a hand-over, in section progress.
const W = SPAN * 0.3

const phrases = computed(() =>
  Array.from({ length: TOTAL }, (_, i) => ({
    before: t(`stickyHeadline.phrase${i + 1}Before`),
    accent: t(`stickyHeadline.phrase${i + 1}Accent`),
    after: t(`stickyHeadline.phrase${i + 1}After`),
  })),
)

const sectionRef = ref<HTMLElement | null>(null)
const { scrollYProgress } = useScroll({
  target: sectionRef,
  offset: ['start start', 'start -220%'],
})
// ζ = 1 (damping = 2·√stiffness), response ≈ 0.3 s.
const progress = useSpring(scrollYProgress, { stiffness: 400, damping: 40, mass: 1 })

// Photos of phrase i mount once the scroll is within reach of it.
const ready = ref([true, false, false])
useMotionValueEvent(progress, 'change', (v) => {
  ready.value.forEach((r, i) => {
    if (!r && v >= i * SPAN - 0.2) ready.value[i] = true
  })
})
watch(reduce, (r) => { if (r) ready.value = [true, true, true] })

// 0 = single page (phones), 1 = open book (sm and up). Only steers the
// cards' fan poses; the album's own layout is CSS, so SSR is right.
const layout = motionValue(0)
let bookQuery: MediaQueryList | undefined
const syncLayout = () => layout.set(bookQuery?.matches ? 1 : 0)
onMounted(() => {
  bookQuery = window.matchMedia('(min-width: 40rem)')
  syncLayout()
  bookQuery.addEventListener('change', syncLayout)
})
onBeforeUnmount(() => bookQuery?.removeEventListener('change', syncLayout))

// ── Timeline (section progress 0…1) ─────────────────────────────────
// Fan opens as phrase 2 arrives.
const FAN_OPEN = [SPAN - W / 2, SPAN + W * 0.7] as const
// Album gathers across the 2 → 3 hand-over: the book rises in behind
// the fan (it fades in on its own clock as the scroll passes BOOK_AT —
// see useCrossing), its first photo is already on the page, then the
// guests' cards set off one after another (see CARDS `order`).
const BOOK_AT = 2 * SPAN - 0.1
const BOOK_RISE = [2 * SPAN - 0.105, 2 * SPAN - 0.02] as const
const WIDE_IN = [2 * SPAN - 0.085, 2 * SPAN - 0.035] as const
const LAND = { from: 2 * SPAN - 0.08, step: 0.02, length: 0.14 }
const CHIP_IN = [2 * SPAN + 0.09, 2 * SPAN + 0.17] as const
// Photos drift inside their frames while the album stays pinned.
const DRIFT = [2 * SPAN, 1] as const

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** Eased 0→1 progress of `v` through [from, to]. */
const phase = (v: number, from: number, to: number) => easeInOut(clamp01((v - from) / (to - from)))

// ── Geometry, in stage units: the stage is 100 wide, 125 tall as a
// page (4:5) and 62.5 tall as a book (8:5). ──────────────────────────
interface Box { x: number; y: number; w: number; h: number }
const STAGE_H: Record<Layout, number> = { page: 125, book: 62.5 }
const SLOTS = {
  // Left page: the hero. Right page: a wide shot over two portraits.
  // Tucks are where the cards that get no slot of their own vanish:
  // into the spine (the page's middle on phones), shrinking to
  // TUCK_SCALE as they fade. 3:4 like every card, and as big as the
  // card in the fan, so no card is ever scaled up.
  book: {
    hero: { x: 6.85, y: 5.5, w: 37.5, h: 50 },
    wide: { x: 55.65, y: 5.5, w: 37.5, h: 24.5 },
    left: { x: 55.65, y: 31.5, w: 18, h: 24 },
    right: { x: 75.15, y: 31.5, w: 18, h: 24 },
    tuckL: { x: 35.75, y: 17.6, w: 20.5, h: 27.33 },
    tuckR: { x: 43.75, y: 17.6, w: 20.5, h: 27.33 },
  },
  // One page: the wide shot over two portraits, as on the book's right page.
  page: {
    wide: { x: 9.5, y: 8, w: 83, h: 50 },
    left: { x: 9.5, y: 61, w: 40, h: 53.33 },
    right: { x: 52.5, y: 61, w: 40, h: 53.33 },
    tuck: { x: 33.5, y: 40, w: 33, h: 44 },
  },
} satisfies Record<Layout, Record<string, Box>>

// The fan (phrase 2): card widths per tier, horizontal offsets of the
// five cards from the centre, and the top edge the cards align to —
// low enough that the top of the album's wide shot shows above the
// fan when it appears. `hug`: how far the phrase-2 line comes down
// towards the fan (see phase2Offsets).
const FAN_GEOMETRY: Record<Layout, { top: number; hug: number; width: Record<Tier, number>; x: number[] }> = {
  book: { top: 8, hug: 0, width: { center: 26, inner: 22.5, outer: 20.5 }, x: [-23.8, -12.3, 0, 12.3, 23.8] },
  page: { top: 24, hug: 14, width: { center: 38.8, inner: 33, outer: 28 }, x: [-30.5, -17, 0, 17, 30.5] },
}

// Phrase 2 composition. The stage is laid out for the album, which is
// taller than the fan, so the headline and the fan would sit high with
// an empty band below them (on phones a tall one). Until the book rises
// in, the stage comes down by half of what stays empty and the phrase-2
// line comes down `hug` more towards the fan, so the two read as one
// group in the middle of the screen — about where phrase 1's line was.
// In stage units; both glide back as the book rises (transform only).
function phase2Offsets(l: Layout) {
  const fan = FAN_GEOMETRY[l]
  const below = STAGE_H[l] - (fan.top + (fan.width.center * 4) / 3)
  const stage = (below - fan.hug) / 2
  return { stage, headline: stage + fan.hug }
}

// The stage: 4:5 page on phones, 8:5 book from sm, as wide as the
// content column allows but short enough that the headline above it
// and the chip hanging off its bottom edge stay on screen. On short
// screens (phones held sideways) the headline is set smaller (see
// Headline), so the stage takes all the height that leaves: the header
// clearance, the headline and its gap, and the chip's overhang.
const SHORT_STAGE = '[@media(max-height:30rem)]:w-[min(100%,22rem,calc((100svh_-_11.25rem)_*_0.8))]! sm:[@media(max-height:30rem)]:w-[min(100%,56rem,calc((100svh_-_11.25rem)_*_1.6))]!'
const STAGE_CLASS = `@container relative aspect-[4/5] w-[min(100%,22rem,max(16rem,calc((100svh_-_16rem)_*_0.8)))] sm:aspect-[8/5] sm:w-[min(100%,56rem,max(16rem,calc((100svh_-_20rem)_*_1.6)))] 3xl:w-[min(100%,72rem,calc((100svh_-_28rem)_*_1.6))] 4xl:w-[min(100%,100rem,calc((100svh_-_32rem)_*_1.6))] ${SHORT_STAGE}`

// Largest CSS width a stage-unit width reaches: the stage is at most
// 22rem as a page, 56rem / 72rem / 100rem as a book (see STAGE_CLASS).
const sizesFor = (book: number, page: number) =>
  `(min-width: 160rem) ${Math.round(book * 16)}px, (min-width: 120rem) ${Math.round(book * 11.52)}px, (min-width: 40rem) ${Math.round(book * 8.96)}px, ${Math.round(page * 3.52)}px`

// Photo slots — see landing-image-slots.md for what each should show.
// Fan left → right. Every card flies above the book and its first
// photo; in the fan the centre card is on top (z) and the inner ones
// cover the outer ones. `order`: when the card sets off, in LAND steps
// — the tucked ones first, so none is still fading over a finished
// page, then the landing ones left to right.
const CARDS = [
  { photo: 'fairy-lights', rot: -18, tier: 'outer', slot: { page: 'tuck', book: 'tuckL' }, z: 3, order: { page: 0, book: 0 } },
  { photo: 'confetti', rot: -9, tier: 'inner', slot: { page: 'tuck', book: 'hero' }, z: 4, order: { page: 0.25, book: 1 } },
  { photo: 'hand-holding', rot: 0, tier: 'center', slot: { page: 'left', book: 'left' }, z: 5, order: { page: 1.5, book: 2 } },
  { photo: 'lace-texture', rot: 9, tier: 'inner', slot: { page: 'right', book: 'right' }, z: 4, order: { page: 2.5, book: 3 } },
  { photo: 'ribbons', rot: 18, tier: 'outer', slot: { page: 'tuck', book: 'tuckR' }, z: 3, order: { page: 0.5, book: 0.5 } },
] as const satisfies readonly {
  photo: PhotoName
  rot: number
  tier: Tier
  slot: { page: keyof typeof SLOTS.page; book: keyof typeof SLOTS.book }
  z: number
  order: Record<Layout, number>
}[]
type Card = (typeof CARDS)[number]
// Already in the album before the guests' cards land.
const WIDE_PHOTO: PhotoName = 'album-sparklers'

const SINGLE_PHOTO: PhotoName = 'embrace'
// Reduced motion / no JS only: the static fan of phrase 2 (the animated
// one is the album stage in its fan pose). Here the album stands right
// under the fan instead of growing out of it, so the middle three are
// other guests' shots than the album's; the outer two never make it
// into the static album.
const FAN = [
  { rot: -18, x: -2.2, z: 1, photo: CARDS[0].photo, size: 'h-32 w-24 sm:h-44 sm:w-32 md:h-56 md:w-40 lg:h-60 lg:w-44 xl:h-64 xl:w-48 2xl:h-72 2xl:w-52 3xl:h-80 3xl:w-60 4xl:h-96 4xl:w-72' },
  { rot: -9, x: -1.05, z: 2, photo: 'vintage-camera', size: 'h-36 w-28 sm:h-48 sm:w-36 md:h-60 md:w-44 lg:h-64 lg:w-48 xl:h-72 xl:w-52 2xl:h-80 2xl:w-56 3xl:h-[22rem] 3xl:w-64 4xl:h-[26rem] 4xl:w-80' },
  { rot: 0, x: 0, z: 3, photo: 'waiter', size: 'h-40 w-32 sm:h-52 sm:w-40 md:h-64 md:w-48 lg:h-72 lg:w-52 xl:h-80 xl:w-60 2xl:h-[22rem] 2xl:w-64 3xl:h-[26rem] 3xl:w-72 4xl:h-[30rem] 4xl:w-[22rem]' },
  { rot: 9, x: 1.05, z: 2, photo: 'hands-closeup', size: 'h-36 w-28 sm:h-48 sm:w-36 md:h-60 md:w-44 lg:h-64 lg:w-48 xl:h-72 xl:w-52 2xl:h-80 2xl:w-56 3xl:h-[22rem] 3xl:w-64 4xl:h-[26rem] 4xl:w-80' },
  { rot: 18, x: 2.2, z: 1, photo: CARDS[4].photo, size: 'h-32 w-24 sm:h-44 sm:w-32 md:h-56 md:w-40 lg:h-60 lg:w-44 xl:h-64 xl:w-48 2xl:h-72 2xl:w-52 3xl:h-80 3xl:w-60 4xl:h-96 4xl:w-72' },
] as const satisfies readonly { rot: number; x: number; z: number; photo: PhotoName; size: string }[]
// object-position for photos whose subject sits off-centre in the 2:3
// master (the cards crop it to about 3:4); the rest stay centred.
const POSITION: Partial<Record<PhotoName, string>> = {
  'fairy-lights': 'center 60%',
  'lace-texture': 'center 80%',
}

const SIZES = {
  single: '(min-width: 160rem) 512px, (min-width: 120rem) 448px, (min-width: 96rem) 384px, (min-width: 80rem) 320px, (min-width: 64rem) 288px, (min-width: 48rem) 256px, 208px',
  fan: '(min-width: 120rem) 352px, (min-width: 80rem) 240px, (min-width: 48rem) 192px, 128px',
}

// How far the section tucks under the stats: the empty top half of the
// pinned scene (50vh) less what phrase 1 and its header clearance take
// of it, and less a 7.5rem gap, per breakpoint (measured).
const PULL = '[--pull:14rem] md:[--pull:15rem] lg:[--pull:17.5rem] xl:[--pull:18.5rem] 2xl:[--pull:21rem] 3xl:[--pull:23rem] 4xl:[--pull:26rem] motion-safe:-mt-[max(0px,calc(50vh_-_var(--pull)))] noscript:mt-0!'

// Warm gradient shown while a phrase's photos aren't mounted yet.
const PLACEHOLDER = { background: 'linear-gradient(135deg, oklch(88% 0.05 40), oklch(93% 0.035 65) 55%, oklch(84% 0.06 30))' }

// Without JavaScript the photos of phrases 2 and 3 never mount, so
// under (scripting: none) the placeholder draws its photo as a CSS
// background instead. The rule never matches with JavaScript on, so
// nobody else downloads the photo early or twice.
const NOJS_PHOTO = 'noscript:bg-(image:--nojs-photo)! noscript:bg-cover! noscript:bg-position-(--nojs-position)!'
// Props of the frame a photo sits in: `cls` plus the placeholder.
const photoFrame = (photo: PhotoName, show: boolean, cls: string) => ({
  class: show ? cls : `${cls} ${NOJS_PHOTO}`,
  style: show
    ? PLACEHOLDER
    : {
        ...PLACEHOLDER,
        '--nojs-photo': `url(/images/${photo}-${PHOTOS[photo].widths.at(-1)}.webp)`,
        '--nojs-position': POSITION[photo] ?? 'center',
      },
})

// Mats: the photo's corner is the mat's corner minus the mat, so the
// white border runs at one width all the way round. `single`: the big
// print of phrase 1 (16 px corner, 8 px mat → 8 px). `fan`: the static
// fan, with the thin mat of the animated fan's prints (Print) — a
// 3 px photo corner inside a mat that grows with the card.
const MATS = {
  single: { mat: 'rounded-2xl p-2', photo: 'rounded-sm' },
  fan: { mat: 'rounded-[7px] p-1 sm:rounded-[9px] sm:p-1.5 lg:rounded-[11px] lg:p-2 3xl:rounded-[13px] 3xl:p-2.5', photo: 'rounded-[3px]' },
} as const

// Photo card — white mat with the photo, or the placeholder while the
// phrase's photos aren't mounted yet.
const PhotoCard = defineComponent({
  props: {
    photo: { type: String as PropType<PhotoName>, required: true },
    show: { type: Boolean, default: true },
    sizes: { type: String, required: true },
    rotate: { type: Number, default: 0 },
    mat: { type: String as PropType<keyof typeof MATS>, default: 'single' },
    cls: { type: String, default: '' },
  },
  setup(p) {
    return () =>
      h('div', {
        class: `relative bg-white shadow-(--shadow-soft) ${MATS[p.mat].mat} ${p.cls}`,
        style: p.rotate ? { rotate: `${p.rotate}deg` } : undefined,
      }, [
        h('div', photoFrame(p.photo, p.show, `h-full w-full overflow-hidden ${MATS[p.mat].photo}`), p.show
          ? h(MarketingPhoto, { name: p.photo, sizes: p.sizes, position: POSITION[p.photo], class: 'h-full w-full object-cover' })
          : undefined),
      ])
  },
})

// Static fan card (reduced motion). Offset in % of the card's own
// width, so the fan keeps its shape from phone to 4K.
const FanCard = defineComponent({
  props: {
    card: { type: Object as PropType<(typeof FAN)[number]>, required: true },
    show: { type: Boolean, required: true },
  },
  setup(p) {
    return () =>
      h('div', {
        class: 'absolute left-1/2 top-0 -translate-x-1/2',
        style: { transform: `translateX(${p.card.x * 52}%) rotate(${p.card.rot}deg)`, zIndex: p.card.z },
      }, h(PhotoCard, { photo: p.card.photo, show: p.show, sizes: SIZES.fan, mat: 'fan', cls: p.card.size }))
  },
})

/**
 * `mark` sorts the progress into sides (a phrase index, before / after
 * a point); `on(side)` runs whenever the scroll moves to another side —
 * the scroll triggers, the motion plays on its own clock (and retargets
 * from where it is if the scroll turns mid-way). It also runs once at
 * setup, with `instant`, for the starting side.
 */
function useCrossing(progress: MotionValue<number>, mark: (v: number) => number, on: (side: number, instant: boolean) => void) {
  let side = mark(progress.get())
  on(side, true)
  useMotionValueEvent(progress, 'change', (v) => {
    const next = mark(v)
    if (next === side) return
    side = next
    on(side, false)
  })
}

// A phrase's line: in when the scroll is within its span, rising in
// from below and leaving upward (the reverse when scrolled back). The
// incoming line waits for the outgoing one to be mostly gone.
const phraseAt = (v: number) => Math.min(TOTAL - 1, Math.max(0, Math.floor(v / SPAN)))
function useLineTrack(progress: MotionValue<number>, index: number) {
  const opacity = motionValue(0)
  const y = motionValue(0)
  useCrossing(progress, phraseAt, (at, instant) => {
    const shown = at === index
    const to = { opacity: shown ? 1 : 0, y: shown ? 0 : at > index ? -32 : 32 }
    if (instant) {
      opacity.set(to.opacity)
      y.set(to.y)
      return
    }
    const transition = shown ? { ...SPRING.default, delay: 0.12 } : SPRING.snappy
    animate(opacity, to.opacity, transition)
    animate(y, to.y, transition)
  })
  return { opacity, y }
}

// Opacity + rise of a phrase layer's visual: arrives from below over
// [inStart, inStart + W], leaves upward over [outStart, outStart + W].
function useTrack(progress: MotionValue<number>, inStart: number | null, outStart: number | null) {
  const inputs: number[] = []
  const opacity: number[] = []
  const y: number[] = []
  if (inStart !== null) { inputs.push(inStart, inStart + W); opacity.push(0, 1); y.push(32, 0) }
  if (outStart !== null) { inputs.push(outStart, outStart + W); opacity.push(1, 0); y.push(0, -32) }
  return {
    opacity: useTransform(progress, inputs, opacity, { ease: easeInOut }),
    y: useTransform(progress, inputs, y, { ease: easeInOut }),
  }
}

const STATIC = 'motion-reduce:opacity-100! motion-reduce:transform-none! noscript:opacity-100! noscript:transform-none!'

const Headline = defineComponent({
  props: {
    phrase: { type: Object as PropType<{ before: string; accent: string; after: string }>, required: true },
    track: { type: Object as PropType<ReturnType<typeof useTrack>>, required: true },
    reduce: { type: Boolean, required: true },
    cls: { type: String, default: '' },
  },
  setup(p) {
    return () =>
      h(
        motion.h2,
        {
          // Short screens: a smaller line, so the pictures under it
          // aren't squeezed into thumbnails.
          class: `heading-display-xl px-4 text-center [@media(max-height:30rem)]:text-[2.5rem]! ${STATIC} ${p.cls}`,
          style: p.reduce ? undefined : { opacity: p.track.opacity, y: p.track.y },
        },
        () => [
          h('span', { class: 'text-(--color-foreground)' }, p.phrase.before),
          ' ',
          h('span', { class: 'italic font-medium text-(--color-primary)' }, p.phrase.accent),
          p.phrase.after
            ? [' ', h('span', { class: 'text-(--color-foreground)' }, p.phrase.after)]
            : null,
        ],
      )
  },
})

// Screens shorter than 30rem (phones held sideways) get smaller gaps
// and photos, so the headline clears the site header and the album's
// chip stays on screen.
const LAYER = 'absolute inset-0 flex flex-col items-center justify-center gap-8 pt-20 md:gap-12 3xl:gap-16 3xl:pt-28 4xl:gap-20 4xl:pt-36 [@media(max-height:30rem)]:gap-5! motion-reduce:relative motion-reduce:inset-auto motion-reduce:py-16 motion-reduce:pt-16 noscript:relative noscript:inset-auto noscript:py-16 noscript:pt-16'

// Phrase 1 (single photo) and, under reduced motion or without JS only,
// phrase 2 (static fan): a text layer and a visual layer, each with its
// own motion.
const PhraseLayer = defineComponent({
  props: {
    index: { type: Number, required: true },
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    reduce: { type: Boolean, required: true },
    show: { type: Boolean, required: true },
    phrase: { type: Object as PropType<{ before: string; accent: string; after: string }>, required: true },
    cls: { type: String, default: '' },
  },
  setup(p) {
    const start = p.index * SPAN
    const end = start + SPAN
    const isFirst = p.index === 0
    // The line hands over at the boundary (useLineTrack); the visuals
    // dissolve across it (centred on it), so the pinned screen is
    // never empty mid-scroll.
    const text = useLineTrack(p.progress, p.index)
    const visual = useTrack(p.progress, isFirst ? null : start - W / 2, end - W / 2)

    const renderVisual = () =>
      p.index === 0
        ? h(PhotoCard, {
            photo: SINGLE_PHOTO,
            show: p.show,
            sizes: SIZES.single,
            rotate: -3,
            cls: 'h-64 w-52 md:h-80 md:w-64 lg:h-[22rem] lg:w-72 xl:h-[24rem] xl:w-80 2xl:h-[28rem] 2xl:w-96 3xl:h-[34rem] 3xl:w-[28rem] 4xl:h-[40rem] 4xl:w-[32rem] [@media(max-height:30rem)]:aspect-[4/5] [@media(max-height:30rem)]:h-[calc(100svh-11.5rem)]! [@media(max-height:30rem)]:w-auto!',
          })
        : h(
            'div',
            { class: 'relative h-40 w-full max-w-[420px] sm:h-52 md:h-64 md:max-w-[560px] lg:h-72 lg:max-w-[640px] xl:h-80 xl:max-w-[760px] 2xl:h-[22rem] 2xl:max-w-[880px] 3xl:h-[26rem] 3xl:max-w-[1040px] 4xl:h-[30rem] 4xl:max-w-[1280px]' },
            FAN.map((card, i) => h(FanCard, { key: i, card, show: p.show })),
          )

    return () =>
      h('div', { class: `${LAYER} ${p.cls}` }, [
        h(Headline, { phrase: p.phrase, track: text, reduce: p.reduce }),
        h(
          motion.div,
          {
            class: `relative flex w-full justify-center ${STATIC}`,
            style: p.reduce ? undefined : { opacity: visual.opacity, y: visual.y },
          },
          renderVisual,
        ),
      ])
  },
})

// ── The album ───────────────────────────────────────────────────────
const slotOf = (card: Card, l: Layout): Box => (SLOTS[l] as Record<string, Box>)[card.slot[l]]!
const isTucked = (card: Card, l: Layout) => card.slot[l].startsWith('tuck')
const TUCK_SCALE = 0.6

// Card pose as a transform relative to its album slot — translate in %
// of the card's own box, so it scales with the stage. Identity = landed.
function cardPose(card: Card, index: number, v: number, l: Layout) {
  const slot = slotOf(card, l)
  const fan = FAN_GEOMETRY[l]
  const width = fan.width[card.tier]
  const height = width * (slot.h / slot.w)
  const cy = fan.top + height / 2
  const toX = (cx: number) => ((cx - (slot.x + slot.w / 2)) / slot.w) * 100
  const toY = (y: number) => ((y - (slot.y + slot.h / 2)) / slot.h) * 100
  // Phrase 2: the cards start stacked on the centre card, then open.
  const open = phase(v, FAN_OPEN[0], FAN_OPEN[1])
  const fx = lerp(toX(50), toX(50 + fan.x[index]!), open)
  const fr = lerp(card.rot * 0.25, card.rot, open)
  // Phrase 3: fly to the slot, lifting a little mid-flight; a tucked
  // card shrinks into the spine and fades on the way.
  const from = LAND.from + card.order[l] * LAND.step
  const k = phase(v, from, from + LAND.length)
  const lift = Math.sin(Math.PI * k)
  const tucked = isTucked(card, l)
  return {
    x: lerp(fx, 0, k),
    y: lerp(toY(cy), 0, k) - lift * 8,
    scale: lerp(width / slot.w, tucked ? TUCK_SCALE : 1, k) * (1 + lift * 0.04),
    rotate: lerp(fr, 0, k),
    opacity: tucked ? 1 - phase(v, from + LAND.length * 0.2, from + LAND.length * 0.75) : 1,
  }
}

// Position of a box as CSS custom properties for both layouts; the
// classes in SLOT_CLASS pick the right set per breakpoint.
const boxVars = (page: Box | null, book: Box | null) => ({
  ...(page && { '--pl': `${page.x}%`, '--pt': `${(page.y / STAGE_H.page) * 100}%`, '--pw': `${page.w}%`, '--ph': `${(page.h / STAGE_H.page) * 100}%` }),
  ...(book && { '--bl': `${book.x}%`, '--bt': `${(book.y / STAGE_H.book) * 100}%`, '--bw': `${book.w}%`, '--bh': `${(book.h / STAGE_H.book) * 100}%` }),
})
const SLOT_CLASS = 'absolute left-(--pl) top-(--pt) w-(--pw) h-(--ph) sm:left-(--bl) sm:top-(--bt) sm:w-(--bw) sm:h-(--bh)'

// A mounted print: white mat, photo inside, drifting slowly in its frame.
const Print = defineComponent({
  props: {
    photo: { type: String as PropType<PhotoName>, required: true },
    show: { type: Boolean, required: true },
    sizes: { type: String, required: true },
    drift: { type: Object as PropType<MotionValue<string>>, default: undefined },
    reduce: { type: Boolean, required: true },
  },
  setup(p) {
    return () =>
      h('div', { class: 'h-full w-full rounded-[1.8cqw] bg-white p-[1.3cqw] shadow-(--shadow-soft) sm:rounded-[0.9cqw] sm:p-[0.65cqw]' }, [
        h('div', photoFrame(p.photo, p.show, 'h-full w-full overflow-hidden rounded-[1cqw] sm:rounded-[0.45cqw]'), p.show
          ? h(
              motion.div,
              {
                class: 'h-full w-full motion-reduce:transform-none! noscript:transform-none!',
                style: p.reduce || !p.drift ? undefined : { scale: 1.08, y: p.drift },
              },
              () => h(MarketingPhoto, { name: p.photo, sizes: p.sizes, position: POSITION[p.photo], class: 'h-full w-full object-cover' }),
            )
          : undefined),
      ])
  },
})

const AlbumCard = defineComponent({
  props: {
    card: { type: Object as PropType<Card>, required: true },
    index: { type: Number, required: true },
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    show: { type: Boolean, required: true },
    reduce: { type: Boolean, required: true },
  },
  setup(p) {
    const card = p.card
    const pose = (key: 'x' | 'y' | 'scale' | 'rotate' | 'opacity') =>
      useTransform([p.progress, layout], ([v, l]: number[]) => cardPose(card, p.index, v!, l ? 'book' : 'page')[key])
    const x = useTransform(pose('x'), (v) => `${v}%`)
    const y = useTransform(pose('y'), (v) => `${v}%`)
    const scale = pose('scale')
    const rotate = pose('rotate')
    const opacity = pose('opacity')
    // Landed cards drift inside their frames while the album is pinned.
    const drift = useTransform(p.progress, [DRIFT[0], DRIFT[1]], ['3%', '-3%'])

    const tuckedOnPage = isTucked(card, 'page')
    const tuckedInBook = isTucked(card, 'book')
    const sizes = sizesFor(
      tuckedInBook ? FAN_GEOMETRY.book.width[card.tier] : Math.max(slotOf(card, 'book').w, FAN_GEOMETRY.book.width[card.tier]),
      tuckedOnPage ? FAN_GEOMETRY.page.width[card.tier] : Math.max(slotOf(card, 'page').w, FAN_GEOMETRY.page.width[card.tier]),
    )
    // The static album (reduced motion, no JS) has no place for tucked cards.
    const hide = tuckedInBook
      ? 'motion-reduce:hidden noscript:hidden'
      : tuckedOnPage ? 'motion-reduce:hidden sm:motion-reduce:block noscript:hidden sm:noscript:block' : ''
    return () =>
      h(
        motion.div,
        {
          class: `${SLOT_CLASS} will-change-transform motion-reduce:transform-none! noscript:transform-none! ${hide}`,
          style: {
            ...boxVars(slotOf(card, 'page'), slotOf(card, 'book')),
            zIndex: card.z,
            ...(p.reduce ? {} : { x, y, scale, rotate, opacity }),
          },
        },
        () => h(Print, { photo: card.photo, show: p.show, sizes, drift: isTucked(card, 'book') && isTucked(card, 'page') ? undefined : drift, reduce: p.reduce }),
      )
  },
})

// Linen boards and paper, drawn in CSS (no texture images to load).
const LINEN = 'repeating-linear-gradient(0deg, oklch(100% 0 0 / 0.05) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, oklch(0% 0 0 / 0.05) 0 1px, transparent 1px 3px)'
const PAPER = 'repeating-linear-gradient(0deg, oklch(55% 0.03 60 / 0.025) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, oklch(55% 0.03 60 / 0.02) 0 1px, transparent 1px 4px)'
const COVER_STYLE = {
  backgroundColor: 'oklch(50% 0.075 32)',
  backgroundImage: LINEN,
  boxShadow: '0 1px 2px rgb(60 30 20 / 0.2), 0 30px 60px -28px rgb(110 60 40 / 0.55), 0 14px 28px -16px rgb(110 60 40 / 0.35)',
}
const pageStyle = (gutter: 'left' | 'right') => ({
  backgroundColor: 'oklch(98.4% 0.009 80)',
  // Soft shade where the page curves into the gutter.
  backgroundImage: `linear-gradient(to ${gutter}, transparent 82%, oklch(45% 0.04 50 / 0.1) 96%, oklch(45% 0.04 50 / 0.2)), ${PAPER}`,
})

const AlbumBook = defineComponent({
  setup() {
    const pageNumber = 'absolute bottom-[3%] font-display text-[3.2cqw] italic leading-none text-(--color-muted-foreground)/60 sm:bottom-[2.6%] sm:text-[1.5cqw]'
    return () => [
      h('div', { class: 'absolute inset-0 rounded-[3cqw] sm:rounded-[1.6cqw]', style: COVER_STYLE }),
      // Phone: one page, bound on the left.
      h('div', { class: 'absolute inset-y-[1.6%] left-[4.5%] right-[1.8%] rounded-r-[2cqw] rounded-l-[0.6cqw] sm:hidden', style: pageStyle('left') }, [
        h('span', { class: `${pageNumber} right-[8%]` }, '13'),
      ]),
      // Book: an open spread, left and right pages meeting at the spine.
      h('div', { class: 'absolute inset-y-[2.2%] left-[1.2%] right-1/2 hidden rounded-l-[1cqw] sm:block', style: pageStyle('right') }, [
        h('span', { class: `${pageNumber} left-[8%]` }, '12'),
      ]),
      h('div', { class: 'absolute inset-y-[2.2%] left-1/2 right-[1.2%] hidden rounded-r-[1cqw] sm:block', style: pageStyle('left') }, [
        h('span', { class: `${pageNumber} right-[8%]` }, '13'),
      ]),
      // Page edges: the book's thickness at the outer edges.
      h('div', {
        class: 'absolute inset-y-[3%] right-[0.5%] w-[1.4%] rounded-r-[1cqw] sm:left-[0.5%] sm:right-auto sm:w-[0.7%]',
        style: { backgroundImage: 'repeating-linear-gradient(90deg, oklch(96% 0.01 80) 0 1px, oklch(88% 0.015 70) 1px 2px)' },
      }),
      h('div', {
        class: 'absolute inset-y-[3%] right-[0.5%] hidden w-[0.7%] rounded-r-[1cqw] sm:block',
        style: { backgroundImage: 'repeating-linear-gradient(90deg, oklch(96% 0.01 80) 0 1px, oklch(88% 0.015 70) 1px 2px)' },
      }),
    ]
  },
})

// Phrases 2 and 3 on one stage: the fan and the album it gathers into.
const AlbumLayer = defineComponent({
  props: {
    progress: { type: Object as PropType<MotionValue<number>>, required: true },
    reduce: { type: Boolean, required: true },
    show: { type: Object as PropType<boolean[]>, required: true },
    phrases: { type: Array as PropType<{ before: string; accent: string; after: string }[]>, required: true },
    count: { type: String, required: true },
  },
  setup(p) {
    const text2 = useLineTrack(p.progress, 1)
    const text3 = useLineTrack(p.progress, 2)
    const stage = useTrack(p.progress, SPAN - W / 2, null)
    const bookOpacity = motionValue(0)
    useCrossing(p.progress, (v) => (v >= BOOK_AT ? 1 : 0), (on, instant) => {
      if (instant) bookOpacity.set(on)
      else animate(bookOpacity, on, SPRING.snappy)
    })
    const bookScale = useTransform(p.progress, [BOOK_RISE[0], BOOK_RISE[1]], [0.92, 1], { ease: easeOut })
    const bookY = useTransform(p.progress, [BOOK_RISE[0], BOOK_RISE[1]], ['4%', '0%'], { ease: easeOut })
    const wideOpacity = useTransform(p.progress, [WIDE_IN[0], WIDE_IN[1]], [0, 1], { ease: easeInOut })
    const wideDrift = useTransform(p.progress, [DRIFT[0], DRIFT[1]], ['4%', '-4%'])
    const chipOpacity = useTransform(p.progress, [CHIP_IN[0], CHIP_IN[1]], [0, 1], { ease: easeInOut })
    const chipY = useTransform(p.progress, [CHIP_IN[0], CHIP_IN[1]], [12, 0], { ease: easeInOut })

    // Phrase 2 offsets (see phase2Offsets), in px: one stage unit is 1%
    // of the stage's width, measured once mounted (0 until then). They
    // glide back to 0 with the book's rise.
    const stageEl = ref<HTMLElement | null>(null)
    const unit = motionValue(0)
    let resize: ResizeObserver | undefined
    onMounted(() => {
      if (!stageEl.value) return
      resize = new ResizeObserver(([entry]) => unit.set((entry?.contentRect.width ?? 0) / 100))
      resize.observe(stageEl.value)
    })
    onBeforeUnmount(() => resize?.disconnect())
    const phase2 = (key: 'stage' | 'headline') =>
      useTransform([p.progress, layout, unit], ([v, l, u]: number[]) =>
        phase2Offsets(l ? 'book' : 'page')[key] * u! * (1 - easeOut(clamp01((v! - BOOK_RISE[0]) / (BOOK_RISE[1] - BOOK_RISE[0])))))
    const stageLift = phase2('stage')
    const headlineLift = phase2('headline')
    const stageY = useTransform([stage.y, stageLift], ([a, b]: number[]) => a! + b!)
    const text2Lowered = { opacity: text2.opacity, y: useTransform([text2.y, headlineLift], ([a, b]: number[]) => a! + b!) }

    const motionStyle = <S extends object>(style: S) => (p.reduce ? undefined : style)

    return () =>
      h('div', { class: LAYER }, [
        // Both lines share one grid cell, so they hand over in place.
        h('div', { class: 'grid w-full place-items-center' }, [
          h(Headline, { phrase: p.phrases[1]!, track: text2Lowered, reduce: p.reduce, cls: 'col-start-1 row-start-1 motion-reduce:hidden noscript:hidden' }),
          h(Headline, { phrase: p.phrases[2]!, track: text3, reduce: p.reduce, cls: 'col-start-1 row-start-1' }),
        ]),
        h(
          motion.div,
          {
            // Side padding = the page gutter: the layer spans the
            // container's padding box, and the book shouldn't touch the
            // screen edges on tablets.
            class: `relative flex w-full justify-center px-5 lg:px-8 xl:px-10 ${STATIC}`,
            style: motionStyle({ opacity: stage.opacity, y: stageY }),
          },
          () => h(
            'div',
            { ref: stageEl, class: STAGE_CLASS },
            [
              // The book and the photo already in it rise in together,
              // under the guests' cards (z 3–5).
              h(
                motion.div,
                { class: `absolute inset-0 z-[1] ${STATIC}`, style: motionStyle({ opacity: bookOpacity, scale: bookScale, y: bookY }) },
                () => [
                  h(AlbumBook),
                  h(
                    motion.div,
                    {
                      class: `${SLOT_CLASS} ${STATIC}`,
                      style: { ...boxVars(SLOTS.page.wide, SLOTS.book.wide), ...motionStyle({ opacity: wideOpacity }) },
                    },
                    () => h(Print, { photo: WIDE_PHOTO, show: p.show[2] ?? false, sizes: sizesFor(SLOTS.book.wide.w, SLOTS.page.wide.w), drift: wideDrift, reduce: p.reduce }),
                  ),
                ],
              ),
              CARDS.map((card, i) => h(AlbumCard, { key: card.photo, card, index: i, progress: p.progress, show: p.show[1] ?? false, reduce: p.reduce })),
              // Glass chip on the book's bottom edge.
              h(
                'div',
                { class: 'absolute bottom-0 left-1/2 z-[6] -translate-x-1/2 translate-y-1/2' },
                h(
                  motion.div,
                  {
                    class: `flex items-center gap-2 whitespace-nowrap rounded-full border border-white/70 bg-white/75 px-4 py-2 text-sm font-medium text-(--color-foreground) shadow-(--shadow-soft) backdrop-blur-md 3xl:px-5 3xl:py-2.5 3xl:text-base ${STATIC}`,
                    style: motionStyle({ opacity: chipOpacity, y: chipY }),
                  },
                  () => [h(Images, { class: 'size-4 text-(--color-primary) 3xl:size-5', 'aria-hidden': 'true' }), p.count],
                ),
              ),
            ],
          ),
        ),
      ])
  },
})
</script>

<template>
  <!-- Pinned, phrase 1 sits in the middle of the screen, so on the way in
       half a screen of empty scene would follow the stats. The section
       tucks under them instead (PULL), leaving a section's gap between
       the last tile and the headline; it holds nothing to click, so the
       tiles it overlaps keep their pointer. Static stack: no tuck. -->
  <section
    ref="sectionRef"
    :class="`pointer-events-none relative motion-reduce:h-auto! noscript:h-auto! ${PULL}`"
    :style="{ height: '320vh' }"
  >
    <div class="sticky top-0 h-screen overflow-x-clip motion-reduce:static motion-reduce:h-auto noscript:static noscript:h-auto">
      <MarketingFloatingOrnaments :count="14" :hue-base="25" :hue-spread="70" />
      <div class="container-page relative h-full motion-reduce:h-auto noscript:h-auto">
        <PhraseLayer
          :index="0"
          :progress="progress"
          :reduce="reduce"
          :show="ready[0] ?? false"
          :phrase="phrases[0]!"
        />
        <PhraseLayer
          :index="1"
          :progress="progress"
          :reduce="reduce"
          :show="ready[1] ?? false"
          :phrase="phrases[1]!"
          cls="motion-safe:hidden noscript:flex!"
        />
        <AlbumLayer
          :progress="progress"
          :reduce="reduce"
          :show="ready"
          :phrases="phrases"
          :count="t('stickyHeadline.albumCount')"
        />
      </div>
    </div>
  </section>
</template>
