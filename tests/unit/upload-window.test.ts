import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadWindow, uploadWindowState } from '../../server/utils/upload-window'

// Tashkent is UTC+5 all year: 18:00 local = 13:00Z, 12:00 local = 07:00Z.
const at = (iso: string) => Date.parse(iso)

describe('uploadWindow', () => {
  it('opens at 18:00 the evening before and closes at 12:00 the day after (Asia/Tashkent)', () => {
    const w = uploadWindow('2026-11-08')!
    expect(w.opensAt.toISOString()).toBe('2026-11-07T13:00:00.000Z')
    expect(w.closesAt.toISOString()).toBe('2026-11-09T07:00:00.000Z')
  })

  it('crosses month and year boundaries', () => {
    expect(uploadWindow('2027-01-01')!.opensAt.toISOString()).toBe('2026-12-31T13:00:00.000Z')
    expect(uploadWindow('2026-12-31')!.closesAt.toISOString()).toBe('2027-01-01T07:00:00.000Z')
    expect(uploadWindow('2026-03-01')!.opensAt.toISOString()).toBe('2026-02-28T13:00:00.000Z')
    expect(uploadWindow('2028-03-01')!.opensAt.toISOString()).toBe('2028-02-29T13:00:00.000Z')
  })

  it('is 42 hours long', () => {
    const w = uploadWindow('2026-06-15')!
    expect(w.closesAt.getTime() - w.opensAt.getTime()).toBe(42 * 3_600_000)
  })

  it('returns null for anything that is not YYYY-MM-DD', () => {
    for (const d of ['', '2026-1-8', '08.11.2026', '2026-11-08T00:00:00Z', 'tomorrow', '20261108']) {
      expect(uploadWindow(d)).toBeNull()
    }
  })
})

describe('uploadWindowState', () => {
  const day = '2026-11-08'

  it('is "before" up to the last millisecond before 18:00 the day before', () => {
    expect(uploadWindowState(day, at('2026-11-01T00:00:00Z'))).toBe('before')
    expect(uploadWindowState(day, at('2026-11-07T12:59:59.999Z'))).toBe('before')
  })

  it('is "open" from exactly 18:00 the day before…', () => {
    expect(uploadWindowState(day, at('2026-11-07T13:00:00.000Z'))).toBe('open')
  })

  it('…through the wedding night (the reception runs past midnight)…', () => {
    expect(uploadWindowState(day, at('2026-11-08T13:00:00Z'))).toBe('open') // 18:00 on the day
    expect(uploadWindowState(day, at('2026-11-08T19:30:00Z'))).toBe('open') // 00:30 the next day
  })

  it('…until the last millisecond before 12:00 the day after', () => {
    expect(uploadWindowState(day, at('2026-11-09T06:59:59.999Z'))).toBe('open')
    expect(uploadWindowState(day, at('2026-11-09T07:00:00.000Z'))).toBe('after')
    expect(uploadWindowState(day, at('2027-01-01T00:00:00Z'))).toBe('after')
  })

  it('never locks guests out over a malformed date', () => {
    expect(uploadWindowState('not-a-date', at('2026-11-08T10:00:00Z'))).toBe('open')
  })
})

describe('time zone handling', () => {
  const savedTz = process.env.TZ
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ
    else process.env.TZ = savedTz
    vi.restoreAllMocks()
  })

  it('does not depend on the server time zone', () => {
    const expected = uploadWindow('2026-11-08')!
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      const w = uploadWindow('2026-11-08')!
      expect(w.opensAt.getTime(), tz).toBe(expected.opensAt.getTime())
      expect(w.closesAt.getTime(), tz).toBe(expected.closesAt.getTime())
    }
  })

  it('falls back to UTC+5 on a runtime without time zone data', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('Invalid time zone specified: Asia/Tashkent')
    })
    const w = uploadWindow('2026-11-08')!
    expect(w.opensAt.toISOString()).toBe('2026-11-07T13:00:00.000Z')
    expect(w.closesAt.toISOString()).toBe('2026-11-09T07:00:00.000Z')
  })
})
