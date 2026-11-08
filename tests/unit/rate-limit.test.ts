import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRateLimit, getTrustedClientIp, hitRateLimit } from '../../server/utils/rate-limit'

let n = 0
/** A scope no other test has touched (the limiter's state is module-wide). */
const scope = () => `test-${++n}`

describe('hitRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Later than the module's own clock, so its prune timer runs under the fake clock.
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('allows `limit` hits per window, then refuses', () => {
    const s = scope()
    for (let i = 0; i < 3; i++) expect(hitRateLimit(s, 'ip', 3, 60_000)).toEqual({ ok: true, retryAfterSec: 0 })
    expect(hitRateLimit(s, 'ip', 3, 60_000).ok).toBe(false)
  })

  it('says how long until the oldest hit leaves the window', () => {
    const s = scope()
    hitRateLimit(s, 'ip', 2, 60_000)
    vi.advanceTimersByTime(20_000)
    hitRateLimit(s, 'ip', 2, 60_000)
    vi.advanceTimersByTime(5_500)
    expect(hitRateLimit(s, 'ip', 2, 60_000)).toEqual({ ok: false, retryAfterSec: 35 }) // 34.5 s, rounded up
  })

  it('never answers a refusal with Retry-After 0', () => {
    const s = scope()
    hitRateLimit(s, 'ip', 1, 1_000)
    vi.advanceTimersByTime(999)
    expect(hitRateLimit(s, 'ip', 1, 1_000)).toEqual({ ok: false, retryAfterSec: 1 })
  })

  it('slides: a slot frees up as soon as the oldest hit expires', () => {
    const s = scope()
    expect(checkRateLimit(s, 'ip', 1, 10_000)).toBe(true)
    vi.advanceTimersByTime(9_999)
    expect(checkRateLimit(s, 'ip', 1, 10_000)).toBe(false)
    vi.advanceTimersByTime(2)
    expect(checkRateLimit(s, 'ip', 1, 10_000)).toBe(true)
  })

  it('does not count refused requests against the future', () => {
    const s = scope()
    hitRateLimit(s, 'ip', 1, 10_000)
    for (let i = 0; i < 5; i++) hitRateLimit(s, 'ip', 1, 10_000)
    vi.advanceTimersByTime(10_001)
    expect(hitRateLimit(s, 'ip', 1, 10_000).ok).toBe(true)
  })

  it('keeps scopes and keys apart', () => {
    const a = scope()
    const b = scope()
    expect(checkRateLimit(a, 'x', 1, 60_000)).toBe(true)
    expect(checkRateLimit(a, 'x', 1, 60_000)).toBe(false)
    expect(checkRateLimit(a, 'y', 1, 60_000)).toBe(true)
    expect(checkRateLimit(b, 'x', 1, 60_000)).toBe(true)
  })

  it('a one-minute scope pruning the map does not wipe a longer window', () => {
    const long = scope()
    const short = scope()
    expect(checkRateLimit(long, 'ip', 1, 10 * 60_000)).toBe(true)
    vi.advanceTimersByTime(2 * 60_000) // past the prune interval and the short window
    checkRateLimit(short, 'ip', 1, 60_000) // triggers a prune
    expect(checkRateLimit(long, 'ip', 1, 10 * 60_000)).toBe(false)
  })
})

describe('getTrustedClientIp', () => {
  const ev = (peer: string | undefined, headers: Record<string, string> = {}) =>
    ({ node: { req: { socket: { remoteAddress: peer }, headers } } }) as never

  it('trusts X-Real-IP from our own proxy', () => {
    expect(getTrustedClientIp(ev('127.0.0.1', { 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getTrustedClientIp(ev('::ffff:127.0.0.1', { 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getTrustedClientIp(ev('10.0.0.5', { 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1')
  })

  it('takes the LAST X-Forwarded-For entry (the one nginx appended), not what the client typed', () => {
    expect(getTrustedClientIp(ev('127.0.0.1', { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('ignores forwarding headers from anyone else', () => {
    const headers = { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '1.1.1.1' }
    expect(getTrustedClientIp(ev('198.51.100.20', headers))).toBe('198.51.100.20')
    expect(getTrustedClientIp(ev('172.32.0.1', headers))).toBe('172.32.0.1') // outside 172.16/12
  })

  it('treats the private ranges as our proxy', () => {
    for (const peer of ['192.168.1.2', '172.16.0.1', '172.31.255.255', 'fd12:3456::1', '::1']) {
      expect(getTrustedClientIp(ev(peer, { 'x-real-ip': '203.0.113.1' })), peer).toBe('203.0.113.1')
    }
  })

  it('ignores header values that are not IP addresses', () => {
    expect(getTrustedClientIp(ev('127.0.0.1', { 'x-real-ip': 'evil', 'x-forwarded-for': 'also-evil' }))).toBe('127.0.0.1')
  })

  it('never returns an empty key', () => {
    expect(getTrustedClientIp(ev(undefined))).toBe('unknown')
  })
})
