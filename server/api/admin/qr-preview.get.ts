import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import {
  renderStyledQRSVG,
  resolveQrSettings,
} from '../../utils/qr-styled'
import { fail } from '../../utils/errors'

/**
 * GET /api/admin/qr-preview
 *
 * Query params:
 *   style      — preset id (a preset is rendered exactly as defined)
 *   text       — what to encode (default: example URL)
 *   fg, bg     — custom hex colors
 *   dot        — square | rounded | circle | classy
 *   corner     — square | rounded | circle | leaf
 *   gFrom, gTo, gAngle — gradient stops + angle
 *
 * Same resolution rules (and validation) as the PDF, so the preview
 * shows exactly what will be printed. Returns an SVG (no logo overlay
 * in preview — the customizer overlays the logo image on top).
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', uid).maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const q = getQuery(event)
  const { style } = resolveQrSettings({}, q)

  const text = typeof q.text === 'string' && q.text.length <= 300 ? q.text : 'https://memour.uz/preview'
  const svg = renderStyledQRSVG(text, style, 400)
  setResponseHeader(event, 'Content-Type', 'image/svg+xml')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return svg
})
