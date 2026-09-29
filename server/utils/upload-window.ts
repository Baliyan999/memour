/**
 * When guests may upload for an event.
 *
 * `events.wedding_date` is a plain date (YYYY-MM-DD) in the couple's
 * local time. Uzbek receptions usually start in the evening and run
 * past midnight, "kelin salom" is the next morning, and some families
 * gather the evening before. So the window is anchored to the local
 * wedding DAY, not to an instant:
 *
 *   opens  — 18:00 the evening before the wedding day   (D-1 18:00)
 *   closes — 12:00 the day after the wedding day        (D+1 12:00)
 *
 * all in Asia/Tashkent. The old rule (±18 h around D 00:00) closed at
 * 18:00 on the wedding day — right when the reception starts.
 * Keep the copy in guest.window.* / terms in sync with these numbers.
 */
export const UPLOAD_TIME_ZONE = 'Asia/Tashkent'
const OPENS_HOURS_BEFORE_DAY = 6 // D 00:00 − 6 h  = D-1 18:00
const CLOSES_HOURS_AFTER_DAY = 36 // D 00:00 + 36 h = D+1 12:00

export type UploadWindowState = 'before' | 'open' | 'after'

/** Offset of `timeZone` from UTC at the given instant, in minutes. */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(utcMs)
    const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]))
    const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!)
    return Math.round((asUtc - utcMs) / 60_000)
  } catch {
    // Runtime without tz data: Tashkent has been UTC+5 with no DST since 1992.
    return 300
  }
}

/** UTC instant of 00:00 local time on `ymd` in UPLOAD_TIME_ZONE. */
function localMidnightUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return guess - zoneOffsetMinutes(guess, UPLOAD_TIME_ZONE) * 60_000
}

export function uploadWindow(weddingDate: string): { opensAt: Date; closesAt: Date } | null {
  const midnight = localMidnightUtc(weddingDate)
  if (midnight == null) return null
  return {
    opensAt: new Date(midnight - OPENS_HOURS_BEFORE_DAY * 3_600_000),
    closesAt: new Date(midnight + CLOSES_HOURS_AFTER_DAY * 3_600_000),
  }
}

export function uploadWindowState(weddingDate: string, now = Date.now()): UploadWindowState {
  const w = uploadWindow(weddingDate)
  // A malformed date can't come out of a `date` column; if it ever
  // does, don't lock guests out over it.
  if (!w) return 'open'
  if (now < w.opensAt.getTime()) return 'before'
  if (now >= w.closesAt.getTime()) return 'after'
  return 'open'
}
