import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendQrPdf } from '../../../utils/qr-pdf'
import { checkRateLimit } from '../../../utils/rate-limit'
import { fail } from '../../../utils/errors'

/**
 * GET /api/couple/qr-pdf/[id] — the couple downloads their own table
 * cards. Only the event's owner_id (= logged-in user) can call, and
 * only once the event is active (paid) — the draft banner promises
 * "pay to unlock the QR codes".
 *
 * The style (preset / colors / logo) is whatever the admin saved on
 * the event. The couple may pick only:
 *   lang   — uz | ru: card language + guest-page locale in the QR
 *   layout — 2x2 | 4x2 | single
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: ev } = await admin
    .from('events')
    .select('id, owner_id, status, couple_names, wedding_date, table_count, qr_settings')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== uid) fail(403, 'forbidden')
  if (ev!.status !== 'active') fail(403, 'event_not_active')

  // A 200-table PDF is a few seconds of CPU — don't let a stuck
  // button (or a script) queue dozens of them.
  if (!checkRateLimit('qr-pdf', uid, 10, 60_000)) fail(429, 'rate_limited')

  const q = getQuery(event)
  try {
    return await sendQrPdf(event, admin, ev!, { lang: q.lang, layout: q.layout })
  } catch (e) {
    console.error('[couple/qr-pdf] render failed', e)
    fail(500, 'pdf_failed')
  }
})
