import PDFDocument from 'pdfkit'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { renderStyledQRPng, getPreset } from '../../../utils/qr-styled'

// Embed Manrope so Cyrillic renders. Cached at module scope so we
// don't read the TTF on every request.
const FONT_PATH = resolve(process.cwd(), 'server/assets/fonts/Manrope-Var.ttf')
let cachedFont: Buffer | null = null
function getFont(): Buffer {
  if (!cachedFont) cachedFont = readFileSync(FONT_PATH)
  return cachedFont
}

/**
 * GET /api/admin/qr-pdf/[id]?style=…&layout=…&font=…
 *
 * Generates a printable PDF with one QR per table.
 *
 *   style:  one of QR_PRESETS ids — controls dot shape, corners, colors
 *   layout: '2x2' (default, 4/page), 'single' (1/page big), '4x2' (8/page)
 *   font:   'manrope' (default, sans) | 'serif' — Cormorant fallback
 *           is left out because PDFKit needs another font file
 *
 * Admin only. Cyrillic-safe via Manrope.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

interface Layout {
  cols: number
  rows: number
  paperWidth: number
  paperHeight: number
  margin: number
  cardPadding: number
  decorative: boolean
}

const LAYOUTS: Record<string, Layout> = {
  '2x2': {
    cols: 2, rows: 2,
    paperWidth: 595.28, paperHeight: 841.89, // A4 in pt
    margin: 36, cardPadding: 14, decorative: true,
  },
  '4x2': {
    cols: 2, rows: 4,
    paperWidth: 595.28, paperHeight: 841.89,
    margin: 28, cardPadding: 10, decorative: false,
  },
  single: {
    cols: 1, rows: 1,
    paperWidth: 595.28, paperHeight: 841.89,
    margin: 60, cardPadding: 30, decorative: true,
  },
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const query = getQuery(event)
  const preset = getPreset(typeof query.style === 'string' ? query.style : null)
  const layout = LAYOUTS[(typeof query.layout === 'string' ? query.layout : null) ?? '2x2'] ?? LAYOUTS['2x2']!

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, table_count')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')

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

    // Card background (decorative layouts only)
    if (layout.decorative) {
      doc.save()
      doc.roundedRect(x, y, colW, rowH, 14).fillAndStroke(preset.style.bg, '#e8d8c6')
      doc.restore()
    }

    // QR — sized to fit minus padding for title + couple names
    const reservedBottom = layout.decorative ? 70 : 28
    const reservedTop = layout.decorative ? 32 : 14
    const qrSize = Math.min(colW, rowH - reservedBottom - reservedTop) - 16
    const qrX = x + (colW - qrSize) / 2
    const qrY = y + reservedTop

    const url = `${baseUrl}/uz/e/${ev!.id}?t=${t}`
    const png = await renderStyledQRPng(url, preset.style, Math.round(qrSize * 3))
    doc.image(png, qrX, qrY, { width: qrSize, height: qrSize })

    // Brand line (top)
    if (layout.decorative) {
      doc.font('Manrope').fillColor('#7a5444').fontSize(9)
      doc.text('MEMOUR', x, y + 14, { width: colW, align: 'center', characterSpacing: 2 })
    }

    // Bottom labels
    const textY = qrY + qrSize + 10
    doc.fillColor('#3a2010').fontSize(layout.cols === 1 ? 34 : 20)
    doc.text(`Стол ${t}`, x, textY, { width: colW, align: 'center' })

    if (layout.decorative) {
      doc.fillColor('#7a5444').fontSize(layout.cols === 1 ? 14 : 10)
      doc.text(ev!.couple_names, x, textY + (layout.cols === 1 ? 46 : 28), {
        width: colW,
        align: 'center',
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
