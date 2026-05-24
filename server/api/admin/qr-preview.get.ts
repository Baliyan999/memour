import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import {
  renderStyledQRSVG,
  getPreset,
  type QRStyle,
} from '../../utils/qr-styled'

/**
 * GET /api/admin/qr-preview
 *
 * Query params:
 *   style      — preset id (overridden by explicit fields below)
 *   text       — what to encode (default: example URL)
 *   fg, bg     — custom hex colors
 *   dot        — square | rounded | circle | classy
 *   corner     — square | rounded | circle | leaf
 *   gFrom, gTo, gAngle — gradient stops + angle
 *
 * Returns an SVG (no logo overlay in preview — would need rasterising
 * to PNG with sharp which is slower; preview already renders fine
 * without it).
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
  const style: QRStyle = {
    dot: (typeof q.dot === 'string' ? q.dot : preset.style.dot) as any,
    corner: (typeof q.corner === 'string' ? q.corner : preset.style.corner) as any,
    fg: typeof q.fg === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.fg) ? q.fg : preset.style.fg,
    bg: typeof q.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.bg) ? q.bg : preset.style.bg,
    gradient: null,
  }
  if (typeof q.gFrom === 'string' && typeof q.gTo === 'string'
    && /^#[0-9a-fA-F]{6}$/.test(q.gFrom) && /^#[0-9a-fA-F]{6}$/.test(q.gTo)) {
    const angle = typeof q.gAngle === 'string' ? parseFloat(q.gAngle) : 45
    style.gradient = { from: q.gFrom, to: q.gTo, angle: Number.isFinite(angle) ? angle : 45 }
  } else if (preset.style.gradient) {
    style.gradient = preset.style.gradient
  }

  const text = typeof q.text === 'string' ? q.text : 'https://memour.uz/preview'
  const svg = renderStyledQRSVG(text, style, 400)
  setResponseHeader(event, 'Content-Type', 'image/svg+xml')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return svg
})
