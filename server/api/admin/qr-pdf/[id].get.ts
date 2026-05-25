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

// Two fonts on the card:
//   Manrope handles the small ALL-CAPS "MEMOUR" eyebrow — sans-serif
//   reads better at 9pt with letter-spacing.
//   Cormorant Garamond Italic handles the table number, couple names
//   and date — serif italic carries the wedding-stationery feel that
//   was completely missing when everything was rendered in Manrope.
const FONT_DIR = resolve(process.cwd(), 'server/assets/fonts')
const MANROPE_PATH = resolve(FONT_DIR, 'Manrope-Var.ttf')
const CORMORANT_ITALIC_PATH = resolve(FONT_DIR, 'CormorantGaramond-Italic.ttf')

let cachedManrope: Buffer | null = null
let cachedCormorant: Buffer | null = null
function getManrope(): Buffer {
  if (!cachedManrope) cachedManrope = readFileSync(MANROPE_PATH)
  return cachedManrope
}
function getCormorant(): Buffer {
  if (!cachedCormorant) cachedCormorant = readFileSync(CORMORANT_ITALIC_PATH)
  return cachedCormorant
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

  // Set the PDF's internal /Title — Chrome / Safari / Firefox all use
  // this for the tab label when the PDF renders inline. Without it the
  // tab shows the URL slug ("660d104c-…"), which is what Albert was
  // seeing. Also set Author so the metadata reads "Memour" instead of
  // "PDFKit" in any reader that surfaces it.
  const docTitle = `${ev!.couple_names || 'Memour'} — ${ev!.wedding_date}`
  const doc = new PDFDocument({
    size: 'A4',
    margin: layout.margin,
    info: {
      Title: docTitle,
      Author: 'Memour',
      Subject: 'QR-коды столов',
      Creator: 'Memour',
      Producer: 'Memour',
    },
  })
  doc.registerFont('Manrope', getManrope())
  doc.registerFont('Cormorant', getCormorant())
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

    // The decorative layouts need more headroom below the QR for the
    // three-line wedding-stationery text block; the dense `4x2` layout
    // is tighter and only shows the table number.
    const reservedBottom = layout.decorative ? 90 : 30
    const reservedTop = layout.decorative ? 36 : 14
    const qrSize = Math.min(colW, rowH - reservedBottom - reservedTop) - 16
    const qrX = x + (colW - qrSize) / 2
    const qrY = y + reservedTop

    const url = `${baseUrl}/uz/e/${ev!.id}?t=${t}`
    const png = await renderStyledQRPng(url, style, Math.round(qrSize * 3))
    doc.image(png, qrX, qrY, { width: qrSize, height: qrSize })

    if (layout.decorative) {
      // Top "MEMOUR" eyebrow stays in the sans-serif so the wedding
      // text below it has more visual weight.
      doc.font('Manrope').fillColor('#7a5444').fontSize(9)
      doc.text('MEMOUR', x, y + 14, { width: colW, align: 'center', characterSpacing: 2 })
    }

    // Type scale per layout: the single-card layout has room for
    // wedding-invitation sizes; 2x2 still gives the serif room to
    // breathe; 4x2 only gets the table number with no decoration.
    const isSingle = layout.cols === 1
    const sizeTable = isSingle ? 56 : 30
    const sizeNames = isSingle ? 18 : 13
    const sizeDate = isSingle ? 12 : 9

    // Gold hairline divider between QR and text — gives the card the
    // "save the date" feel even at a glance.
    if (layout.decorative) {
      const divY = qrY + qrSize + 12
      const divW = Math.min(colW * 0.4, 80)
      doc.save()
      doc.lineWidth(0.6).strokeColor('#c89e6a')
      doc.moveTo(x + (colW - divW) / 2, divY)
        .lineTo(x + (colW + divW) / 2, divY)
        .stroke()
      doc.restore()
    }

    const textTop = qrY + qrSize + (layout.decorative ? 22 : 10)

    // Table number — serif italic, the hero text on the card.
    doc.font('Cormorant').fillColor('#3a2010').fontSize(sizeTable)
    doc.text(`Стол ${t}`, x, textTop, { width: colW, align: 'center' })

    if (layout.decorative) {
      // Couple names directly below, smaller serif italic
      const namesY = textTop + sizeTable + (isSingle ? 6 : 2)
      doc.font('Cormorant').fillColor('#7a5444').fontSize(sizeNames)
      doc.text(ev!.couple_names, x, namesY, { width: colW, align: 'center' })

      // Wedding date in soft taupe, slightly looser tracking
      const dateY = namesY + sizeNames + (isSingle ? 6 : 3)
      doc.font('Cormorant').fillColor('#a48068').fontSize(sizeDate)
      doc.text(formatCardDate(ev!.wedding_date), x, dateY, {
        width: colW, align: 'center', characterSpacing: 0.5,
      })
    }
  }

  doc.end()
  const pdf = await done

  // Self-identifying filename: "<couple names> <YYYY-MM-DD>.pdf".
  // When the admin downloads several QR PDFs (multiple weddings),
  // they can tell them apart in the Downloads folder at a glance.
  const namePart = (ev!.couple_names || 'event').slice(0, 60).trim()
  const datePart = ev!.wedding_date // already YYYY-MM-DD from the DB
  const utf8Name = `${namePart} ${datePart}.pdf`
  // ASCII fallback for old downloaders that ignore filename* — keep
  // the same shape but transliterate non-Latin chars to underscores.
  const asciiBody = namePart.replace(/[^a-z0-9 ]/gi, '_').replace(/_+/g, '_').trim()
  const asciiName = `${asciiBody || 'event'} ${datePart}.pdf`
  setResponseHeader(event, 'Content-Type', 'application/pdf')
  setResponseHeader(
    event,
    'Content-Disposition',
    `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
  )
  setResponseHeader(event, 'Content-Length', String(pdf.length))
  return pdf
})

/**
 * Format a YYYY-MM-DD wedding date for the card. Russian readers
 * expect "23 мая 2026"; falling back to ISO if the locale formatter
 * produces nothing useful for whatever reason.
 */
function formatCardDate(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00`)
    const out = d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return out || iso
  } catch {
    return iso
  }
}
