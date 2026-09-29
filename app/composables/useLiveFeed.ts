import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'

/** One slideshow item as served by /api/guest/live-init. */
export interface LiveItem {
  id: string
  uploaded_at: string
  guest_name: string | null
  guest_table: number | null
  media_type: string // 'photo' | 'video' | 'voice'
  mime_type: string | null
  duration_ms: number | null
}

export interface LiveFeedResponse {
  event: { couple_names: string }
  photos: LiveItem[]
  hidden: string[]
  total: number
}

/** Why the slideshow can't run — each maps to a full-screen state. */
export type LiveClosedReason = 'not_found' | 'not_active' | 'archived' | 'not_in_plan'

const POLL_MS = 4_000
// Retries back off to this and no further. When the venue router loses
// its uplink the laptop stays on Wi-Fi — no `online` event tells us the
// internet is back, only the next retry does — and a retry is just
// one more small poll.
const MAX_BACKOFF_MS = 8_000
// Draft screen: check back until the couple activates the event.
// The same for a tier without the slideshow — an upgrade starts it.
const NOT_ACTIVE_POLL_MS = 30_000
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Maps a live-init failure to a closed-screen reason. Anything else
 * (network, 5xx) is transient: we keep the stage and retry.
 */
export function liveClosedReason(e: any): LiveClosedReason | null {
  const code = e?.data?.data?.code ?? e?.data?.code
  const status = e?.statusCode ?? e?.status ?? e?.response?.status
  if (code === 'event_archived' || status === 410) return 'archived'
  if (code === 'not_in_plan') return 'not_in_plan'
  if (code === 'event_not_active' || status === 403) return 'not_active'
  if (code === 'event_not_found' || code === 'invalid_id' || status === 404) return 'not_found'
  return null
}

const ts = (s: string) => Date.parse(s)

/**
 * Server-driven feed for the live slideshow.
 *
 * Polls live-init with an `after` cursor every few seconds instead of
 * Realtime: anon can't read `photos` through RLS, so postgres_changes
 * never reached the projector. The cursor gives backfill for free —
 * after a Wi-Fi drop or laptop sleep the next poll returns everything
 * that was missed. Each response also carries the hidden ids, so items
 * the couple hides leave the rotation within one poll.
 *
 * The server serves only the newest items of the album (see
 * live-init); the rotation cycles through those plus everything that
 * arrives while the page runs. Newly arrived items are handed to
 * `onFresh` (the stage shows them first); hidden ones to `onHide`.
 */
export function useLiveFeed(
  eventId: string,
  opts: {
    initial: LiveFeedResponse | null
    initialError: unknown
    onFresh?: (items: LiveItem[]) => void
    onHide?: (ids: string[]) => void
  },
) {
  const url = `/api/guest/live-init/${eventId}`

  /** Every item we know about, newest first (hidden ones included — see `hidden`). */
  const items = shallowRef<LiveItem[]>([])
  const hidden = shallowRef<Set<string>>(new Set())
  const total = ref(0)
  const coupleNames = ref('')
  const connection = ref<'live' | 'reconnecting'>('live')
  const closed = ref<LiveClosedReason | null>(null)

  const byId = new Map<string, LiveItem>()
  let newest: string | null = null
  // Items the couple un-hid that we never had (they were hidden before
  // we loaded) — fetched by id on the next poll.
  let restore: string[] = []

  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight = false
  let pollAgain = false
  let failures = 0
  // The first successful load seeds the rotation; only what arrives
  // after it counts as "fresh".
  let seeded = !!opts.initial
  let disposed = false

  function merge(res: LiveFeedResponse): { added: LiveItem[]; newlyHidden: string[] } {
    const added: LiveItem[] = []
    for (const p of res.photos) {
      if (byId.has(p.id)) continue
      byId.set(p.id, p)
      added.push(p)
      if (!newest || ts(p.uploaded_at) > ts(newest)) newest = p.uploaded_at
    }
    if (added.length) {
      items.value = [...byId.values()].sort((a, b) => ts(b.uploaded_at) - ts(a.uploaded_at))
    }

    const next = new Set(res.hidden)
    const prev = hidden.value
    const newlyHidden = res.hidden.filter((id) => !prev.has(id))
    for (const id of prev) {
      if (!next.has(id) && !byId.has(id)) restore.push(id)
    }
    if (newlyHidden.length || next.size !== prev.size) hidden.value = next

    total.value = res.total
    coupleNames.value = res.event.couple_names
    return { added, newlyHidden }
  }

  function schedulePoll(ms: number) {
    if (disposed) return
    clearTimeout(pollTimer)
    pollTimer = setTimeout(poll, ms)
  }

  async function poll() {
    pollTimer = undefined
    if (disposed) return
    if (inFlight) {
      pollAgain = true
      return
    }
    inFlight = true
    const restoring = restore.splice(0, 50)
    const query: Record<string, string> = {}
    if (newest) query.after = newest
    if (restoring.length) query.ids = restoring.join(',')
    let next = POLL_MS
    try {
      const res = await $fetch<LiveFeedResponse>(url, { query, timeout: REQUEST_TIMEOUT_MS, retry: 0 })
      if (disposed) return
      failures = 0
      connection.value = 'live'
      closed.value = null
      const { added, newlyHidden } = merge(res)
      if (newlyHidden.length) opts.onHide?.(newlyHidden)
      const fresh = seeded ? added.filter((p) => !restoring.includes(p.id)) : []
      seeded = true
      if (fresh.length) opts.onFresh?.(fresh)
    } catch (e) {
      if (disposed) return
      restore.unshift(...restoring)
      const reason = liveClosedReason(e)
      if (reason) {
        closed.value = reason
        if (reason === 'archived' || reason === 'not_found') return // nothing to wait for
        next = NOT_ACTIVE_POLL_MS
      } else {
        failures++
        // One slow request isn't worth alarming the room; two in a row is.
        if (failures >= 2 || !navigator.onLine) connection.value = 'reconnecting'
        next = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** (failures - 1))
      }
    } finally {
      inFlight = false
    }
    if (pollAgain) {
      pollAgain = false
      next = 0
    }
    schedulePoll(next)
  }

  /** Poll now (network back, tab visible again, woke from sleep). */
  function pollNow() {
    if (disposed || closed.value === 'archived' || closed.value === 'not_found') return
    if (inFlight) pollAgain = true
    else schedulePoll(0)
  }

  // Seed from the SSR fetch so the first frame needs no extra round-trip.
  if (opts.initial) {
    merge(opts.initial)
  } else if (opts.initialError) {
    closed.value = liveClosedReason(opts.initialError)
    if (!closed.value) connection.value = 'reconnecting'
  }

  function onOnline() {
    pollNow()
  }
  function onOffline() {
    connection.value = 'reconnecting'
  }
  function onVisible() {
    if (document.visibilityState === 'visible') pollNow()
  }

  onMounted(() => {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('pageshow', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    if (closed.value === 'archived' || closed.value === 'not_found') return
    schedulePoll(closed.value === 'not_active' || closed.value === 'not_in_plan'
      ? NOT_ACTIVE_POLL_MS
      : opts.initial ? POLL_MS : 0)
  })

  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(pollTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('pageshow', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  })

  return { items, hidden, total, coupleNames, connection, closed }
}
