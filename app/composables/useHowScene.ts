import { useTransform, type MotionValue } from 'motion-v'

/**
 * Shared bits of the "How it works" scenes (HowScene*.vue).
 *
 * Every scene is driven by one 0→1 timeline: scroll-scrubbed in the
 * desktop stage, played once when a phone card comes into view, pinned
 * at 1 for SSR / no-JS / reduced motion — so the final frame is the
 * static picture everyone else sees.
 */

/**
 * Step response of a critically damped spring (ζ = 1), normalised to
 * 0→1 — the easing of every scene segment, so both the scrubbed and
 * the played timelines settle like the house SPRING (no overshoot).
 */
export function settle(x: number) {
  const k = 7
  return (1 - (1 + k * x) * Math.exp(-k * x)) / (1 - (1 + k) * Math.exp(-k))
}

/** `seg(from, to, a, b)` — slice [from, to] of the timeline mapped a→b on the settle curve. */
export function useSegment(timeline: MotionValue<number>) {
  return <T extends number | string>(from: number, to: number, a: T, b: T) =>
    useTransform(timeline, [from, to], [a, b], { ease: settle })
}

/**
 * QR for https://memour.uz (version 2, 25×25, EC level Q), pre-rendered
 * with the `qrcode` package so the landing ships no QR encoder. `path`
 * holds the data modules as horizontal runs (drawn with a round-capped
 * stroke, so single modules read as dots); the three finder patterns
 * are drawn separately as rounded squares.
 */
export const HOW_QR = {
  size: 25,
  finders: [[0, 0], [18, 0], [0, 18]] as const,
  path: 'M8.5 0.5h0M10.5 0.5h0M13.5 0.5h1M16.5 0.5h0M8.5 1.5h1M11.5 1.5h1M14.5 1.5h1M8.5 2.5h2M12.5 2.5h4M8.5 3.5h3M13.5 3.5h1M16.5 3.5h0M8.5 4.5h2M14.5 4.5h1M9.5 5.5h0M11.5 5.5h2M15.5 5.5h1M8.5 6.5h0M10.5 6.5h0M12.5 6.5h0M14.5 6.5h0M16.5 6.5h0M8.5 7.5h0M10.5 7.5h0M12.5 7.5h4M1.5 8.5h1M4.5 8.5h0M6.5 8.5h1M9.5 8.5h0M11.5 8.5h1M14.5 8.5h0M18.5 8.5h0M20.5 8.5h4M1.5 9.5h1M4.5 9.5h0M7.5 9.5h0M10.5 9.5h0M14.5 9.5h0M16.5 9.5h2M24.5 9.5h0M0.5 10.5h0M2.5 10.5h4M8.5 10.5h2M13.5 10.5h0M16.5 10.5h4M22.5 10.5h2M2.5 11.5h1M8.5 11.5h0M11.5 11.5h1M16.5 11.5h0M20.5 11.5h0M23.5 11.5h0M0.5 12.5h2M4.5 12.5h0M6.5 12.5h1M9.5 12.5h0M12.5 12.5h0M15.5 12.5h3M21.5 12.5h0M23.5 12.5h1M2.5 13.5h1M5.5 13.5h0M7.5 13.5h0M9.5 13.5h0M13.5 13.5h0M17.5 13.5h1M21.5 13.5h0M24.5 13.5h0M0.5 14.5h0M2.5 14.5h0M4.5 14.5h2M8.5 14.5h1M16.5 14.5h1M19.5 14.5h0M22.5 14.5h2M1.5 15.5h1M4.5 15.5h0M9.5 15.5h1M14.5 15.5h0M20.5 15.5h0M23.5 15.5h0M0.5 16.5h0M2.5 16.5h2M6.5 16.5h1M9.5 16.5h0M12.5 16.5h0M16.5 16.5h5M8.5 17.5h0M10.5 17.5h0M12.5 17.5h0M14.5 17.5h0M16.5 17.5h0M20.5 17.5h1M23.5 17.5h1M8.5 18.5h0M15.5 18.5h1M18.5 18.5h0M20.5 18.5h1M23.5 18.5h1M13.5 19.5h0M16.5 19.5h0M20.5 19.5h1M8.5 20.5h0M11.5 20.5h3M16.5 20.5h5M24.5 20.5h0M12.5 21.5h1M19.5 21.5h3M8.5 22.5h3M15.5 22.5h1M20.5 22.5h0M24.5 22.5h0M8.5 23.5h0M10.5 23.5h4M16.5 23.5h0M18.5 23.5h0M20.5 23.5h1M23.5 23.5h0M9.5 24.5h0M11.5 24.5h0M14.5 24.5h3M19.5 24.5h0M23.5 24.5h1',
}
