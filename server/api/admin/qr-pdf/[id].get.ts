import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

// PDFKit's built-in fonts (Helvetica, etc.) don't carry Cyrillic
// glyphs, so we embed Manrope variable font. The file is bundled in
// server/assets/fonts/ — Nitro packs that path into the build via
// `useStorage('assets:server')` automatically.
const FONT_PATH = resolve(process.cwd(), 'server/assets/fonts/Manrope-Var.ttf')
let cachedFont: Buffer | null = null
function getFont(): Buffer {
  if (!cachedFont) cachedFont = readFileSync(FONT_PATH)
  return cachedFont
}

/**
 * GET /api/admin/qr-pdf/[id] — generate a printable PDF with one
 * QR code per table. 4 cards per A4 page (2×2 grid). Each card
 * encodes /uz/e/{event_id}?t={table_number} and shows the table
 * number + couple names in display type.
 *
 * Caller must be an admin (validated via the `admins` table).
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', user!.id)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, table_count')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')

  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl

  // Generate PDF in memory. PDFKit streams chunks; we collect them
  // into a single Buffer for the response.
  const doc = new PDFDocument({ size: 'A4', margin: 36 })
  // Register Manrope as the active font so subsequent draws use it
  // (and Cyrillic glyphs render correctly).
  const fontBuf = getFont()
  doc.registerFont('Manrope', fontBuf)
  doc.font('Manrope')

  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolveFn) => {
    doc.on('end', () => resolveFn(Buffer.concat(chunks)))
  })

  const tableCount = ev!.table_count ?? 10
  const pageW = doc.page.width
  const pageH = doc.page.height
  const margin = 36
  const colGap = 14
  const rowGap = 14
  const colW = (pageW - margin * 2 - colGap) / 2
  const rowH = (pageH - margin * 2 - rowGap) / 2

  for (let t = 1; t <= tableCount; t++) {
    const indexOnPage = (t - 1) % 4
    if (t > 1 && indexOnPage === 0) doc.addPage()

    const col = indexOnPage % 2
    const row = Math.floor(indexOnPage / 2)
    const x = margin + col * (colW + colGap)
    const y = margin + row * (rowH + rowGap)

    // Card background
    doc.save()
    doc.roundedRect(x, y, colW, rowH, 12).fillAndStroke('#fbf6f0', '#e8d8c6')
    doc.restore()

    // QR code as PNG data URL
    const url = `${baseUrl}/uz/e/${ev!.id}?t=${t}`
    const png = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 600,
      color: { dark: '#3a2010', light: '#fbf6f0' },
    })

    const qrSize = Math.min(colW, rowH) - 90
    const qrX = x + (colW - qrSize) / 2
    const qrY = y + 40
    doc.image(png, qrX, qrY, { width: qrSize, height: qrSize })

    // Top brand
    doc.font('Manrope').fillColor('#7a5444').fontSize(9)
    doc.text('MEMOUR', x, y + 14, { width: colW, align: 'center', characterSpacing: 2 })

    // Table number — bigger, bold-ish via larger size since variable
    // font weight axis isn't trivially set in pdfkit
    doc.fillColor('#3a2010').fontSize(22)
    doc.text(`Стол ${t}`, x, qrY + qrSize + 8, { width: colW, align: 'center' })

    // Couple names below
    doc.fillColor('#7a5444').fontSize(10)
    doc.text(ev!.couple_names, x, qrY + qrSize + 38, { width: colW, align: 'center' })
  }

  doc.end()
  const pdf = await done

  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="memour-qr-${ev!.couple_names.replace(/[^a-z0-9а-яё ]/gi, '_').slice(0, 40)}.pdf"`,
  )
  setResponseHeader(event, 'Content-Length', String(pdf.length))
  return pdf
})
