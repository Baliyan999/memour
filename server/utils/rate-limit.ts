import type { H3Event } from 'h3'
import { isIP } from 'node:net'

/**
 * Simple in-memory sliding-window rate limiter. Per-process state —
 * good enough for single-instance Nitro; when we scale horizontally
 * we'll swap to Redis or a Supabase table. The durable caps (per phone
 * / IP / hour on the login endpoints) are counted in Postgres by the
 * endpoints themselves.
 *
 * Usage:
 *   if (!checkRateLimit('upload', `${eventId}:${deviceId}`, 20, 60_000))
 *     fail(429, 'rate_limited')
 *
 * Use `hitRateLimit` when the caller wants to send a Retry-After.
 */

interface Bucket {
  timestamps: number[]
  windowMs: number
}
const buckets = new Map<string, Bucket>()

// Periodically prune buckets that haven't been touched in a while
// so the map doesn't grow unbounded across long-running processes.
// Each bucket expires by its OWN window: callers use anything from one
// minute to an hour, and pruning by the caller's window let a
// one-minute scope wipe a ten-minute bucket after two minutes.
const PRUNE_EVERY_MS = 60_000
let lastPrune = Date.now()
function pruneIfNeeded(now: number) {
  if (now - lastPrune < PRUNE_EVERY_MS) return
  lastPrune = now
  for (const [key, bucket] of buckets) {
    const last = bucket.timestamps.at(-1)
    if (last === undefined || last < now - bucket.windowMs) buckets.delete(key)
  }
}

/**
 * Consume one slot. `retryAfterSec` is how long until the oldest hit
 * in the window expires (0 when allowed). The check is consume-first:
 * a successful check also records the current timestamp, counting
 * against future requests.
 */
export function hitRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  pruneIfNeeded(now)
  const k = `${scope}:${key}`
  const bucket = buckets.get(k) ?? { timestamps: [], windowMs }
  // Drop timestamps outside the window.
  const cutoff = now - windowMs
  while (bucket.timestamps.length && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift()
  }
  if (bucket.timestamps.length >= limit) {
    buckets.set(k, bucket)
    const retryAfterMs = bucket.timestamps[0]! + windowMs - now
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
  }
  bucket.timestamps.push(now)
  buckets.set(k, bucket)
  return { ok: true, retryAfterSec: 0 }
}

/** Returns true if the action is allowed, false if rate-limited. */
export function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  return hitRateLimit(scope, key, limit, windowMs).ok
}

/** Loopback, RFC 1918 and unique-local addresses — i.e. our own proxy. */
function isPrivatePeer(addr: string): boolean {
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  if (a === '::1' || a.startsWith('127.')) return true
  if (a.startsWith('10.') || a.startsWith('192.168.')) return true
  const m = /^172\.(\d+)\./.exec(a)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true
  return /^f[cd][0-9a-f]{2}:/i.test(a)
}

/**
 * Client IP for rate limiting, taken only from sources the client
 * can't forge. Every per-IP limit (guest upload + binding, login, lead
 * form) keys on this.
 *
 * In production nginx sits in front of Node on the same box
 * (docs/DEPLOY.md → nginx) and sets `X-Real-IP $remote_addr`, which
 * overwrites whatever the client sent, and appends the peer to
 * `X-Forwarded-For` ($proxy_add_x_forwarded_for). Those headers are
 * trusted only when the TCP peer is our own proxy (loopback / private
 * network): X-Real-IP first, else the LAST X-Forwarded-For entry — the
 * one nginx appended; the leftmost entries are whatever the client
 * typed. A request that reaches Node directly is keyed by its socket
 * address, so it can't pick its own bucket.
 */
export function getTrustedClientIp(event: H3Event): string {
  const peer = event.node.req.socket?.remoteAddress ?? ''
  if (peer && isPrivatePeer(peer)) {
    const real = getRequestHeader(event, 'x-real-ip')?.trim()
    if (real && isIP(real)) return real
    const last = getRequestHeader(event, 'x-forwarded-for')?.split(',').at(-1)?.trim()
    if (last && isIP(last)) return last
  }
  return peer || 'unknown'
}
