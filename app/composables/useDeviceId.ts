/**
 * Stable per-device identifier persisted in localStorage.
 *
 * Generated once on the first visit and reused across all events the
 * device interacts with. The server binds this id to a single
 * (event, table) pair, then enforces that binding plus per-device
 * quota on every subsequent upload — see `server/utils/guest-quota.ts`.
 *
 * SSR-safe: returns an empty string during server render; the real id
 * fills in on mount. Callers should treat an empty string as "not
 * ready yet" rather than a valid id.
 */
const STORAGE_KEY = 'memour:device-id'

/**
 * RFC 4122 v4 UUID that works everywhere the guest page runs.
 * `crypto.randomUUID` exists only in secure contexts (https) and in
 * recent browsers — older in-app webviews and plain-http previews
 * don't have it, and the page used to crash into a 500 there.
 * `getRandomValues` is available on http too.
 */
export function randomUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch { /* fall through */ }
  }
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function useDeviceId() {
  const id = useState<string>('memour-device-id', () => '')

  function ensure() {
    if (typeof window === 'undefined') return
    if (id.value) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && UUID_RE.test(saved)) {
        id.value = saved
        return
      }
      const fresh = randomUuid()
      localStorage.setItem(STORAGE_KEY, fresh)
      id.value = fresh
    } catch {
      // localStorage might be blocked (private mode, iframe with
      // restricted storage). Fall back to an in-memory id valid for
      // the duration of this page session.
      id.value = id.value || randomUuid()
    }
  }

  if (typeof window !== 'undefined') ensure()

  return { id, ensure }
}
