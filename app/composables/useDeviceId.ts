/**
 * Stable per-device identifier persisted in localStorage.
 *
 * Generated once on the first visit and reused across all events the
 * device interacts with. The server binds this id to a single
 * (event, table) pair the first time the device uploads, then
 * enforces that binding plus per-device quota on every subsequent
 * upload — see `server/utils/guest-quota.ts`.
 *
 * SSR-safe: returns an empty string during server render; the real id
 * fills in on mount. Callers should treat an empty string as "not
 * ready yet" rather than a valid id.
 */
const STORAGE_KEY = 'memour:device-id'

export function useDeviceId() {
  const id = useState<string>('memour-device-id', () => '')

  function ensure() {
    if (typeof window === 'undefined') return
    if (id.value) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) {
        id.value = saved
        return
      }
      const fresh = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, fresh)
      id.value = fresh
    } catch {
      // localStorage might be blocked (private mode, iframe with
      // restricted storage). Fall back to an in-memory id valid for
      // the duration of this page session.
      id.value = id.value || crypto.randomUUID()
    }
  }

  if (typeof window !== 'undefined') ensure()

  return { id, ensure }
}
