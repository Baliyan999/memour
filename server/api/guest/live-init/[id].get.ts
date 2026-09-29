import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { fail } from '../../../utils/errors'

/**
 * GET /api/guest/live-init/[id] — the feed behind the live slideshow:
 * event name + visible items, polled by the page every few seconds.
 *
 * Polling (not Realtime) on purpose: the projector is anonymous and
 * RLS hides `photos` from anon, so postgres_changes never reach it.
 * A cursor-based poll also backfills whatever arrived while the venue
 * Wi-Fi was down or the laptop slept.
 *
 * Anonymous: the event id is printed on every table's QR, so this is as
 * public as the /e/[id]/live page itself. The slideshow is part of Pro
 * and up (shared/plans.ts): a Basic event gets 403 not_in_plan whatever
 * its status. Only `active` events are
 * served (draft → 403, archived → 410), and never more than the newest
 * FEED_LIMIT visible items — the projector shows those plus whatever
 * arrives while it runs, and nobody holding the id can page back
 * through the whole album (guest names, tables, voice wishes).
 *
 * Query — within those newest items:
 *   - (none)        all of them, newest first
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
  const after = parseCursor(query.after)
  const ids = new Set(typeof query.ids === 'string'
    ? query.ids.split(',').filter((s) => UUID_RE.test(s)).slice(0, IDS_LIMIT)
    : [])

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, status, plan_tier')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
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

  // Polled every few seconds — never let a proxy or the browser serve a stale page.
  setResponseHeader(event, 'Cache-Control', 'no-store')

  return {
    event: { couple_names: ev!.couple_names },
    photos,
    hidden: (hiddenRes.data ?? []).map((r) => r.id),
    total: countRes.count ?? photos.length,
  }
})
