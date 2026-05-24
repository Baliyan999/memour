import PDFDocument from 'pdfkit'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import {
  renderStyledQRPng,
  getPreset,
  type QRStyle,
} from '../../../utils/qr-styled'

const FONT_PATH = resolve(process.cwd(), 'server/assets/fonts/Manrope-Var.ttf')
let cachedFont: Buffer | null = null
function getFont(): Buffer {
  if (!cachedFont) cachedFont = readFileSync(FONT_PATH)
  return cachedFont
}

/**
 * GET /api/admin/qr-pdf/[id]
 *
 * Query params (override the saved qr_settings on the event):
 *   style, layout, fg, bg, dot, corner, gFrom, gTo, gAngle
 *
 * When no params are passed we use whatever was saved on the event,
 * falling back to the 'mono' preset if still empty. The center logo
 * is pulled from qr_settings.logo_path → branding bucket → downloaded
 * on demand and overlaid.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

interface Layout {
  cols: number
  rows: number
  margin: number
  cardPadding: number
  decorative: boolean
}
const LAYOUTS: Record<string, Layout> = {
  '2x2':    { cols: 2, rows: 2, margin: 36, cardPadding: 14, decorative: true },
  '4x2':    { cols: 2, rows: 4, margin: 28, cardPadding: 10, decorative: false },
  'single': { cols: 1, rows: 1, margin: 60, cardPadding: 30, decorative: true },
}

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
    .select('id, couple_names, wedding_date, venue_name, table_count, qr_settings')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')

  // Merge: saved settings <- preset defaults <- query overrides
  const saved = ((ev as any).qr_settings ?? {}) as Record<string, any>
  const q = getQuery(event)
  const styleId = (typeof q.style === 'string' ? q.style : saved.style) ?? 'mono'
  const preset = getPreset(styleId)
  const layoutId = (typeof q.layout === 'string' ? q.layout : saved.layout) ?? '2x2'
  const layout = LAYOUTS[layoutId] ?? LAYOUTS['2x2']!

  const style: QRStyle = {
    dot: (typeof q.dot === 'string' ? q.dot : (saved.dot ?? preset.style.dot)) as any,
    corner: (typeof q.corner === 'string' ? q.corner : (saved.corner ?? preset.style.corner)) as any,
    fg: (typeof q.fg === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.fg))
      ? q.fg
      : (saved.fg ?? preset.style.fg),
    bg: (typeof q.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(q.bg))
      ? q.bg
      : (saved.bg ?? preset.style.bg),
    gradient: null,
  }
  if (typeof q.gFrom === 'string' && typeof q.gTo === 'string') {
    const angle = typeof q.gAngle === 'string' ? parseFloat(q.gAngle) : 45
    style.gradient = { from: q.gFrom, to: q.gTo, angle: Number.isFinite(angle) ? angle : 45 }
  } else if (saved.gradient) {
    style.gradient = saved.gradient
  } else if (preset.style.gradient) {
    style.gradient = preset.style.gradient
  }

  // Pull the logo if any.
  if (saved.logo_path) {
    const { data: blob } = await admin.storage
      .from('branding').download(saved.logo_path)
    if (blob) style.logo = Buffer.from(await blob.arrayBuffer())
  }

  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl

  const doc = new PDFDocument({ size: 'A4', margin: layout.margin })
  doc.registerFont('Manrope', getFont())
  doc.font('Manrope')
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolveFn) => {
    doc.on('end', () => resolveFn(Buffer.concat(chunks)))
  })

  const tableCount = ev!.table_count ?? 10
  const pageW = doc.page.width
  const pageH = doc.page.height
  const m = layout.margin
  const colGap = layout.cardPadding
  const rowGap = layout.cardPadding
  const colW = (pageW - m * 2 - (layout.cols - 1) * colGap) / layout.cols
  const rowH = (pageH - m * 2 - (layout.rows - 1) * rowGap) / layout.rows
  const perPage = layout.cols * layout.rows

  for (let t = 1; t <= tableCount; t++) {
    const indexOnPage = (t - 1) % perPage
    if (t > 1 && indexOnPage === 0) doc.addPage()
    const col = indexOnPage % layout.cols
    const row = Math.floor(indexOnPage / layout.cols)
    const x = m + col * (colW + colGap)
    const y = m + row * (rowH + rowGap)

    if (layout.decorative) {
      doc.save()
      doc.roundedRect(x, y, colW, rowH, 14).fillAndStroke(style.bg, '#e8d8c6')
      doc.restore()
    }

    const reservedBottom = layout.decorative ? 70 : 28
    const reservedTop = layout.decorative ? 32 : 14
    const qrSize = Math.min(colW, rowH - reservedBottom - reservedTop) - 16
    const qrX = x + (colW - qrSize) / 2
    const qrY = y + reservedTop

    const url = `${baseUrl}/uz/e/${ev!.id}?t=${t}`
    const png = await renderStyledQRPng(url, style, Math.round(qrSize * 3))
    doc.image(png, qrX, qrY, { width: qrSize, height: qrSize })

    if (layout.decorative) {
      doc.font('Manrope').fillColor('#7a5444').fontSize(9)
      doc.text('MEMOUR', x, y + 14, { width: colW, align: 'center', characterSpacing: 2 })
    }

    const textY = qrY + qrSize + 10
    doc.fillColor('#3a2010').fontSize(layout.cols === 1 ? 34 : 20)
    doc.text(`Стол ${t}`, x, textY, { width: colW, align: 'center' })
    if (layout.decorative) {
      doc.fillColor('#7a5444').fontSize(layout.cols === 1 ? 14 : 10)
      doc.text(ev!.couple_names, x, textY + (layout.cols === 1 ? 46 : 28), {
        width: colW, align: 'center',
      })
    }
  }

  doc.end()
  const pdf = await done

  const asciiName = `memour-qr-${ev!.couple_names.replace(/[^a-z0-9 ]/gi, '_').slice(0, 40) || 'event'}.pdf`
  const utf8Name = `memour-qr-${ev!.couple_names.slice(0, 40)}.pdf`
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(
    event,
    'Content-Disposition',
    `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
  )
  setResponseHeader(event, 'Content-Length', String(pdf.length))
  return pdf
})
