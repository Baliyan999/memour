import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { fail } from '../../../utils/errors'
import { safeEqual } from '../../../utils/payments'

/**
 * GET /api/guest/live-init/[id] — the feed behind the live slideshow:
 * event name + visible items, polled by the page every few seconds.
 *
 * Polling (not Realtime) on purpose: the projector is anonymous and
 * RLS hides `photos` from anon, so postgres_changes never reach it.
 * A cursor-based poll also backfills whatever arrived while the venue
 * Wi-Fi was down or the laptop slept.
 *
 * No login (the projector is anonymous), but not open to whoever has
 * the event id either: that id is printed on every table's QR card.
 * Every request carries the event's own secret, `k=<events.live_token>`,
 * from the private link the couple copies in the dashboard (the
 * migration 20261108000100_events_live_token). A missing or wrong one
 * is 403 live_link_invalid, compared in constant time, and comes before
 * the answer says anything about the event beyond whether it exists
 * (its tier, status or names). The couple can replace the secret ("new
 * link", POST /api/couple/event/[id]/live-link); a screen still open on
 * the old link closes at its next poll.
 *
 * The slideshow is part of Pro and up (shared/plans.ts): a Basic event
 * gets 403 not_in_plan whatever its status. Only `active` events are
 * served (draft → 403, archived → 410), and never more than the newest
 * FEED_LIMIT visible items — the projector shows those plus whatever
 * arrives while it runs, and even a valid link can't page back through
 * the whole album (guest names, tables, voice wishes).
 *
 * Query — within those newest items:
 *   - k=<token>     required, see above
 *   - (nothing else) all of them, newest first
 *   - after=<ts>    the ones uploaded after the cursor, oldest first
 *   - ids=a,b,…     these too, e.g. ones the couple just un-hid
 *
 * Every response also lists the ids the couple has hidden (so the
 * projector drops them from rotation) and the visible total.
 */
const FEED_LIMIT = 60
const IDS_LIMIT = 50
const HIDDEN_LIMIT = 1000

// Rows are stamped with now() at insert but only become visible on
// commit, so a row stamped just before the cursor can land after we've
// read past it. Re-reading a few seconds back costs a few duplicates,
// which the page dedupes by id.
const AFTER_OVERLAP_MS = 10_000

const UUID_RE = /^[0-9a-f-]{36}$/i
// events.live_token: 32 hex characters (CHECK events_live_token_format).
const LIVE_TOKEN_RE = /^[0-9a-f]{32}$/
// The shape our responses carry (Postgres timestamptz as JSON). Date.parse
// alone also takes "1", "Jan 1 2026 (x)" or "+275760-…", which Postgres
// refuses — a 500 instead of the client's own mistake.
const CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

/** Accepts an ISO timestamp from a previous response; anything else is a client bug. */
function parseCursor(v: unknown): string | null {
  if (v === undefined || v === '') return null
  if (typeof v !== 'string' || !CURSOR_RE.test(v) || !(Date.parse(v) >= 0)) fail(400, 'invalid_input')
  return v
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) fail(400, 'invalid_id')

  const query = getQuery(event)
  // Never cached anywhere: answers depend on the secret, and the page polls.
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const key = typeof query.k === 'string' ? query.k : ''
  if (!LIVE_TOKEN_RE.test(key)) fail(403, 'live_link_invalid')
  const after = parseCursor(query.after)
  const ids = new Set(typeof query.ids === 'string'
    ? query.ids.split(',').filter((s) => UUID_RE.test(s)).slice(0, IDS_LIMIT)
    : [])

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, status, plan_tier, live_token')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (!safeEqual(key, ev!.live_token)) fail(403, 'live_link_invalid')
  if (!tierHas(ev!.plan_tier, 'live_slideshow')) fail(403, 'not_in_plan')
  if (ev!.status === 'archived') fail(410, 'event_archived')
  if (ev!.status !== 'active') fail(403, 'event_not_active')

  const cols = 'id, uploaded_at, guest_name, guest_table, media_type, mime_type, duration_ms'

  const [headRes, hiddenRes, countRes] = await Promise.all([
    admin.from('photos').select(cols).eq('event_id', id!).eq('is_hidden', false)
      .order('uploaded_at', { ascending: false }).limit(FEED_LIMIT),
    admin.from('photos').select('id').eq('event_id', id!).eq('is_hidden', true).limit(HIDDEN_LIMIT),
    admin.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', id!).eq('is_hidden', false),
  ])
  const err = headRes.error ?? hiddenRes.error ?? countRes.error
  if (err) {
    console.error('[guest/live-init] read failed', err)
    fail(500, 'list_failed')
  }

  let photos = headRes.data ?? []
  if (after) {
    const since = Date.parse(after) - AFTER_OVERLAP_MS
    photos = photos.filter((p) => Date.parse(p.uploaded_at) > since || ids.has(p.id)).reverse()
  }

  return {
    event: { couple_names: ev!.couple_names },
    photos,
    hidden: (hiddenRes.data ?? []).map((r) => r.id),
    total: countRes.count ?? photos.length,
  }
})
