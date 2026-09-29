import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendQrPdf } from '../../../utils/qr-pdf'
import { fail } from '../../../utils/errors'

/**
 * GET /api/admin/qr-pdf/[id]
 *
 * Query params (override the saved qr_settings on the event):
 *   style, layout, lang, fg, bg, dot, corner, gFrom, gTo, gAngle
 *
 * When no params are passed we use whatever was saved on the event,
 * falling back to the 'mono' preset if still empty. The center logo
 * is pulled from qr_settings.logo_path → branding bucket. Rendering
 * lives in server/utils/qr-pdf.ts (shared with the couple endpoint).
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', uid).maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, table_count, qr_settings')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')

  try {
    return await sendQrPdf(event, admin, ev!, getQuery(event))
  } catch (e) {
    console.error('[admin/qr-pdf] render failed', e)
    fail(500, 'pdf_failed')
  }
})
