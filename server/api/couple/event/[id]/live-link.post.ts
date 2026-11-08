import { randomBytes } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { userId } from '../../../../utils/auth'
import { fail } from '../../../../utils/errors'
import { hitRateLimit } from '../../../../utils/rate-limit'
import { UUID_RE } from '../../../../utils/payments'

/**
 * POST /api/couple/event/[id]/live-link — a new private link for the
 * live slideshow ("Новая ссылка / Yangi havola" in the dashboard).
 *
 * The slideshow feed (GET /api/guest/live-init/[id]) is served only
 * with the event's secret, events.live_token, which the couple copies
 * as part of the link /<locale>/e/<id>/live?k=<token>. This replaces
 * the secret: from now on only the new link works, and a screen still
 * open on the old one closes at its next poll (a few seconds). For a
 * link that got forwarded further than the couple wanted.
 *
 * The event's owner only. Answers { live_token } — the same shape the
 * database generates for new events (16 random bytes as 32 hex
 * characters, CHECK events_live_token_format). Never cached.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const uid = await userId(event)
  if (!uid) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !UUID_RE.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: ev, error } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (error) fail(500, 'lookup_failed')
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== uid) fail(403, 'forbidden')

  // A couple needs a new link now and then; this only stops a runaway loop.
  const hit = hitRateLimit('live-link', uid!, 10, 10 * 60_000)
  if (!hit.ok) {
    setResponseHeader(event, 'Retry-After', hit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const token = randomBytes(16).toString('hex')
  const { data: rows, error: upErr } = await admin
    .from('events')
    .update({ live_token: token })
    .eq('id', ev!.id)
    .eq('owner_id', uid!)
    .select('id')
  if (upErr) {
    console.error('[couple/live-link] update failed', upErr.code)
    fail(500, 'update_failed')
  }
  // The event changed hands between the read and the write.
  if (!rows?.length) fail(403, 'forbidden')

  return { live_token: token }
})
