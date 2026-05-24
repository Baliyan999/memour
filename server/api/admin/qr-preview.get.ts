import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { renderStyledQRSVG, getPreset } from '../../utils/qr-styled'

/**
 * GET /api/admin/qr-preview?style=…&text=…
 *
 * Returns an SVG of a single styled QR for the customization modal's
 * live preview. Authenticated admin only.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401 })
  const uid = (user as any).id ?? (user as any).sub
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', uid).maybeSingle()
  if (!adminRow) throw createError({ statusCode: 403 })

  const q = getQuery(event)
  const preset = getPreset(typeof q.style === 'string' ? q.style : null)
  const text = typeof q.text === 'string' ? q.text : 'https://memour.uz/preview'

  const svg = renderStyledQRSVG(text, preset.style, 400)
  setResponseHeader(event, 'Content-Type', 'image/svg+xml')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return svg
})
