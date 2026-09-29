import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { animate, inView } from 'motion-v'

/**
 * Motion tokens + helpers shared by the marketing pages.
 *
 * House style (Apple fluid-interface rules):
 *  • springs by default, critically damped (bounce 0), ~0.3–0.5 s
 *  • a little bounce only right after a gesture that carried momentum
 *  • only transform / opacity move; motion retargets from the current
 *    on-screen value, so every animation can be interrupted
 *  • reduced motion → a short cross-fade, never hidden content
 *
 * The CSS twins of these springs (`--ease-spring`, `--spring-*`) live
 * in main.css for transitions that don't need JS (press, hover).
 */
export const SPRING = {
  /** Default UI spring — response ≈ 0.35 s, no overshoot. */
  default: { type: 'spring', visualDuration: 0.35, bounce: 0 },
  /** Large surfaces and scroll reveals — a touch slower, still no overshoot. */
  gentle: { type: 'spring', visualDuration: 0.5, bounce: 0 },
  /** Press / hover feedback. */
  snappy: { type: 'spring', visualDuration: 0.22, bounce: 0 },
  /** Only after a flick or drag release that carried momentum. */
  momentum: { type: 'spring', visualDuration: 0.4, bounce: 0.18 },
} as const

/** Reduced-motion stand-in for any movement: a short opacity fade. */
export const FADE = { duration: 0.2, ease: 'easeOut' } as const

/** Delay between siblings of a staggered reveal, seconds. */
export const STAGGER = 0.06

/** Travel of a scroll reveal, px — content settles in, it doesn't fly in. */
export const RISE = 18

/**
 * Reduced-motion flag that is safe to branch templates on: `false` on
 * the server and during hydration (so the first client render matches
 * the SSR HTML), the real media-query value right after mount, live.
 * CSS-only fallbacks (`motion-reduce:` classes) cover the moment
 * before this flips.
 */
export function usePrefersReducedMotion(): Ref<boolean> {
  const reduce = ref(false)
  let mq: MediaQueryList | undefined
  const sync = () => { reduce.value = !!mq?.matches }
  onMounted(() => {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    sync()
    mq.addEventListener('change', sync)
  })
  onBeforeUnmount(() => mq?.removeEventListener('change', sync))
  return reduce
}

export interface RevealOptions {
  /** Selector for children revealed one after another (default: the target itself). */
  items?: string
  /** Seconds before the first element starts. */
  delay?: number
  /** Seconds between siblings. */
  stagger?: number
  /** Rise distance in px. */
  y?: number
  /** Fraction of the target that must be visible before it fires. */
  amount?: number
}

/**
 * Progressive scroll reveal. The SSR HTML is always fully visible —
 * nothing waits for JavaScript. After mount, only content that is still
 * BELOW the viewport is tucked away (transparent, lowered by `y`) and
 * then settles in on a critically damped spring once it scrolls into
 * view. Anything already on screen when the JS arrives stays untouched,
 * so there is no flash. Reduced motion gets a short fade, no travel.
 */
export function useReveal(target: Ref<HTMLElement | null | undefined>, opts: RevealOptions = {}) {
  let stop: VoidFunction | undefined
  onMounted(() => {
    const root = target.value
    if (!root) return
    const els = opts.items ? Array.from(root.querySelectorAll<HTMLElement>(opts.items)) : [root]
    if (!els.length || root.getBoundingClientRect().top < window.innerHeight) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const y = reduce ? 0 : (opts.y ?? RISE)
    for (const el of els) animate(el, { opacity: 0, y }, { duration: 0 })

    stop = inView(root, () => {
      els.forEach((el, i) => {
        const delay = (opts.delay ?? 0) + (reduce ? 0 : i * (opts.stagger ?? STAGGER))
        animate(el, { opacity: 1, y: 0 }, reduce ? { ...FADE, delay } : { ...SPRING.gentle, delay })
      })
      stop?.()
    }, { amount: opts.amount ?? 0.15 })
  })
  onBeforeUnmount(() => stop?.())
}
