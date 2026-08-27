/**
 * Simple in-memory sliding-window rate limiter. Per-process state —
 * good enough for single-instance Nitro; when we scale horizontally
 * we'll swap to Redis or a Supabase table.
 *
 * Usage:
 *   if (!checkRateLimit('upload', `${eventId}:${ip}`, 30, 60_000))
 *     fail(429, 'rate_limited')
 */

interface Bucket {
  timestamps: number[]
}
const buckets = new Map<string, Bucket>()

// Periodically prune buckets that haven't been touched in a while
// so the map doesn't grow unbounded across long-running processes.
let lastPrune = Date.now()
function pruneIfNeeded(now: number, windowMs: number) {
  if (now - lastPrune < windowMs)
    return
  lastPrune = now
  const cutoff = now - windowMs * 2
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.length === 0 || bucket.timestamps.at(-1)! < cutoff) {
      buckets.delete(key)
    }
  }
}

/**
 * Returns true if the action is allowed, false if rate-limited.
 * The check is consume-first: a successful check also records the
 * current timestamp, counting against future requests.
 */
export function checkRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now()
  pruneIfNeeded(now, windowMs)
  const k = `${scope}:${key}`
  const bucket = buckets.get(k) ?? { timestamps: [] }
  // Drop timestamps outside the window.
  const cutoff = now - windowMs
  while (bucket.timestamps.length && bucket.timestamps[0]! < cutoff) {
    bucket.timestamps.shift()
  }
  if (bucket.timestamps.length >= limit) {
    buckets.set(k, bucket)
    return false
  }
  bucket.timestamps.push(now)
  buckets.set(k, bucket)
  return true
}
