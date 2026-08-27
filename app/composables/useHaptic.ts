/**
 * Tiny haptic helpers for capture/send interactions.
 *
 * `navigator.vibrate` is supported on Android Chrome and most
 * non-iOS browsers; iOS Safari ignores it silently (Apple's policy:
 * web pages can't drive the Taptic Engine). That's fine — on iOS
 * the visual `active:scale-[0.98]` press already covers it, and we
 * never throw or warn if vibration is missing.
 *
 * Patterns are intentionally short. A wedding guest tapping the
 * shutter wants a flicker of confirmation, not a buzz.
 */
export function useHaptic() {
  function safe(pattern: number | number[]) {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator))
      return
    try {
      navigator.vibrate(pattern)
    }
    catch {
      // Some browsers throw on subsequent vibrate() within a tab — ignore.
    }
  }

  return {
    /** Light single tick — for capture / record button presses. */
    tap: () => safe(8),
    /** Slightly stronger tick — for mode switches or confirm taps. */
    medium: () => safe(14),
    /** Two-step pattern — for upload success / completion. */
    success: () => safe([10, 30, 25]),
    /** Buzzier pattern — for errors or quota-exceeded. */
    error: () => safe([40, 30, 40]),
  }
}
