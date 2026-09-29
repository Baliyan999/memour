import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import type { H3Event } from 'h3'
import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import {
  buildQRGeometry,
  gradientVector,
  resolveQrSettings,
  type QRShape,
  type QRStyle,
  type QrLang,
  type QrLayoutId,
} from './qr-styled'

/**
 * Printable table cards: one QR per table, each pointing at the guest
 * page for that table (`/<lang>/e/<event>?t=<n>`).
 *
 * Shared by GET /api/admin/qr-pdf/[id] (any event, full style
 * overrides) and GET /api/couple/qr-pdf/[id] (the couple's own event,
 * saved style). Callers do their own auth; this module owns layout,
 * fonts and the response headers.
 *
 * Everything is placed by hand on zero-margin pages and every text
 * call gets an explicit height, so pdfkit never paginates on its own —
 * page N always holds exactly tables (N-1)*perPage+1 … N*perPage.
 */

// Two fonts on the card:
//   Manrope handles the small ALL-CAPS "MEMOUR" eyebrow — sans-serif
//   reads better at 9pt with letter-spacing.
//   Cormorant Garamond Italic handles the table number, couple names,
//   date and the scan hint — serif italic carries the
//   wedding-stationery feel.
//
// They are Nitro server assets (server/assets/fonts), bundled into
// .output — reading them from process.cwd() only worked when the
// server happened to start from the repo root.
let fontsPromise: Promise<{ manrope: Buffer; cormorant: Buffer }> | null = null
function loadFonts() {
  fontsPromise ??= (async () => {
    const storage = useStorage('assets:server')
    const [manrope, cormorant] = await Promise.all([
      storage.getItemRaw('fonts/Manrope-Var.ttf'),
      storage.getItemRaw('fonts/CormorantGaramond-Italic.ttf'),
    ])
    if (!manrope || !cormorant) throw new Error('qr-pdf: fonts missing from server assets')
    return { manrope: Buffer.from(manrope as Uint8Array), cormorant: Buffer.from(cormorant as Uint8Array) }
  })()
  // Don't cache a failure forever — the next request retries.
  fontsPromise.catch(() => { fontsPromise = null })
  return fontsPromise
}

interface Layout {
  cols: number
  rows: number
  margin: number
  gap: number
  /** Card background + border, eyebrow, divider, names, date, hint. */
  decorative: boolean
  /** Offset of the QR from the card's top edge. */
  qrTop: number
  /** Minimum space between the QR and the card's side edges. */
  sideInset: number
  type: { table: number; names: number; date: number; hint: number }
}
const LAYOUTS: Record<QrLayoutId, Layout> = {
  '2x2':    { cols: 2, rows: 2, margin: 36, gap: 14, decorative: true,  qrTop: 36, sideInset: 16, type: { table: 30, names: 13, date: 9, hint: 8 } },
  '4x2':    { cols: 2, rows: 4, margin: 28, gap: 10, decorative: false, qrTop: 14, sideInset: 8,  type: { table: 26, names: 0, date: 0, hint: 0 } },
  'single': { cols: 1, rows: 1, margin: 60, gap: 0,  decorative: true,  qrTop: 36, sideInset: 30, type: { table: 56, names: 18, date: 12, hint: 12 } },
}
export const QR_PER_PAGE: Record<QrLayoutId, number> = { '2x2': 4, '4x2': 8, 'single': 1 }

// Card copy per print language. Server-side, so it lives here rather
// than in the i18n bundles.
const CARD_TEXT: Record<QrLang, { table: (n: number) => string; hint: string; dateLocale: string }> = {
  uz: { table: (n) => `Stol ${n}`, hint: 'QR-kodni skanerlang va suratlaringizni yuboring', dateLocale: 'uz-UZ' },
  ru: { table: (n) => `Стол ${n}`, hint: 'Отсканируйте QR-код и отправьте свои фото', dateLocale: 'ru-RU' },
}

const NAMES_MAX_LINES = 3

export interface QrPdfEvent {
  id: string
  couple_names: string
  wedding_date: string
  table_count: number | null
}

export interface QrPdfOptions {
  event: QrPdfEvent
  style: QRStyle
  layout: QrLayoutId
  lang: QrLang
  siteUrl: string
}

/** Guest-page URL a table's QR encodes. */
export function tableUrl(siteUrl: string, lang: QrLang, eventId: string, table: number): string {
  // A trailing slash in NUXT_PUBLIC_SITE_URL would give "//uz/e/…",
  // which the router doesn't match — guests would scan into a 404.
  return `${siteUrl.replace(/\/+$/, '')}/${lang}/e/${eventId}?t=${table}`
}

/**
 * Drop characters the embedded font can't draw (emoji mostly) — they
 * would print as empty boxes on the card.
 */
function printable(doc: PDFKit.PDFDocument, text: string): string {
  const font = (doc as any)._font?.font
  if (!font?.hasGlyphForCodePoint) return text
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    out += cp <= 0x20 || font.hasGlyphForCodePoint(cp) ? ch : ' '
  }
  return out.replace(/\s+/g, ' ').trim()
}

// Circle / rounded-corner control-point offset for cubic Béziers.
const KAPPA = 0.5522847498
const ri = Math.round

/** Filled path for one shape, on whole-number coordinates. */
function pathShape(doc: PDFKit.PDFDocument, s: QRShape) {
  switch (s.kind) {
    case 'rect': {
      const [x, y, w, h] = [ri(s.x), ri(s.y), ri(s.w), ri(s.h)]
      const r = ri(Math.min(s.r, w / 2, h / 2))
      if (r <= 0) {
        doc.rect(x, y, w, h)
        break
      }
      const c = ri(r * (1 - KAPPA))
      doc.moveTo(x + r, y).lineTo(x + w - r, y)
        .bezierCurveTo(x + w - c, y, x + w, y + c, x + w, y + r)
        .lineTo(x + w, y + h - r)
        .bezierCurveTo(x + w, y + h - c, x + w - c, y + h, x + w - r, y + h)
        .lineTo(x + r, y + h)
        .bezierCurveTo(x + c, y + h, x, y + h - c, x, y + h - r)
        .lineTo(x, y + r)
        .bezierCurveTo(x, y + c, x + c, y, x + r, y)
        .closePath()
      break
    }
    case 'circle': {
      const [cx, cy, r] = [ri(s.cx), ri(s.cy), ri(s.r)]
      const o = ri(r * KAPPA)
      doc.moveTo(cx - r, cy)
        .bezierCurveTo(cx - r, cy - o, cx - o, cy - r, cx, cy - r)
        .bezierCurveTo(cx + o, cy - r, cx + r, cy - o, cx + r, cy)
        .bezierCurveTo(cx + r, cy + o, cx + o, cy + r, cx, cy + r)
        .bezierCurveTo(cx - o, cy + r, cx - r, cy + o, cx - r, cy)
        .closePath()
      break
    }
    case 'path':
      doc.path(s.d)
      break
  }
}

/**
 * Paint one layer. The data dots (hundreds of identical round shapes)
 * are drawn as strokes instead of Bézier outlines: a short line with
 * round caps is a circle, and a square stroked with round joins is a
 * rounded square (PDF spec, §8.5.3.2 / 8.5.3.3). That's ~20 bytes a dot
 * instead of ~120 — a 200-table PDF stays around a megabyte.
 *
 * The "short line" is 1 unit (1/100 of a module) rather than zero
 * length: canvas-based viewers (pdf.js in Safari / WKWebView) drop
 * zero-length segments, which left only the finder eyes on the card.
 */
function paintLayer(
  doc: PDFKit.PDFDocument,
  shapes: QRShape[],
  paint: string | PDFKit.PDFGradient,
) {
  const first = shapes[0]!
  const same = (k: QRShape['kind']) => shapes.every((s) => s.kind === k)
  if (shapes.length > 1 && first.kind === 'circle' && same('circle')) {
    doc.save().lineWidth(ri(first.r) * 2).lineCap('round')
    for (const s of shapes as Extract<QRShape, { kind: 'circle' }>[]) {
      doc.moveTo(ri(s.cx), ri(s.cy)).lineTo(ri(s.cx) + 1, ri(s.cy))
    }
    doc.stroke(paint).restore()
    return
  }
  if (shapes.length > 1 && first.kind === 'rect' && first.r > 0 && same('rect')) {
    const r = ri(first.r)
    doc.save().lineWidth(r * 2).lineJoin('round').lineCap('round')
    for (const s of shapes as Extract<QRShape, { kind: 'rect' }>[]) {
      const w = Math.max(0, ri(s.w) - 2 * r)
      const h = Math.max(0, ri(s.h) - 2 * r)
      if (w === 0 && h === 0) doc.moveTo(ri(s.x) + r, ri(s.y) + r).lineTo(ri(s.x) + r + 1, ri(s.y) + r)
      else doc.rect(ri(s.x) + r, ri(s.y) + r, w, h)
    }
    doc.stroke(paint).restore()
    return
  }
  // Everything else (plain squares, finder rings) — one filled path.
  for (const s of shapes) pathShape(doc, s)
  doc.fill(paint)
}

// Geometry resolution: 1/100 of a module — far below print dot size.
const UNITS_PER_MODULE = 100

/** Draw one QR as vector shapes with its top-left corner at (x, y). */
function drawQr(
  doc: PDFKit.PDFDocument,
  text: string,
  style: QRStyle,
  logo: unknown,
  x: number,
  y: number,
  size: number,
) {
  const geo = buildQRGeometry(text, style, { unitsPerModule: UNITS_PER_MODULE }, !!logo)
  const k = size / geo.size
  doc.save()
  doc.translate(x, y)
  doc.rect(0, 0, size, size).fill(style.bg)
  doc.scale(k)
  let fg: string | PDFKit.PDFGradient = style.fg
  if (style.gradient) {
    const v = gradientVector(style.gradient.angle ?? 45, geo.size)
    fg = doc.linearGradient(v.x1, v.y1, v.x2, v.y2)
      .stop(0, style.gradient.from)
      .stop(1, style.gradient.to)
  }
  for (const layer of geo.layers) {
    if (layer.shapes.length) paintLayer(doc, layer.shapes, layer.fill === 'fg' ? fg : style.bg)
  }
  if (logo && geo.logoBox) {
    // Same inner padding as the old raster overlay: 85% of the
    // cleared square.
    const inner = geo.logoBox.size * 0.85
    const off = (geo.logoBox.size - inner) / 2
    doc.image(logo as any, geo.logoBox.x + off, geo.logoBox.y + off, {
      fit: [inner, inner], align: 'center', valign: 'center',
    })
  }
  doc.restore()
}

/**
 * Format a YYYY-MM-DD wedding date for the card in the print
 * language ("23 мая 2026 г." / "23-may, 2026"), falling back to ISO.
 */
function formatCardDate(iso: string, lang: QrLang): string {
  try {
    const d = new Date(`${iso}T00:00:00`)
    const out = d.toLocaleDateString(CARD_TEXT[lang].dateLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    return out || iso
  } catch {
    return iso
  }
}

export async function renderQrPdf(opts: QrPdfOptions): Promise<Buffer> {
  const { event: ev, style, lang } = opts
  const L = LAYOUTS[opts.layout]
  const text = CARD_TEXT[lang]
  const fonts = await loadFonts()

  // Set the PDF's internal /Title — Chrome / Safari / Firefox all use
  // this for the tab label when the PDF renders inline. Without it the
  // tab shows the URL slug ("660d104c-…"). Also set Author so the
  // metadata reads "Memour" instead of "PDFKit" in any reader that
  // surfaces it.
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    info: {
      Title: `${ev.couple_names || 'Memour'} — ${ev.wedding_date}`,
      Author: 'Memour',
      Subject: lang === 'ru' ? 'QR-коды столов' : 'Stollar uchun QR-kodlar',
      Creator: 'Memour',
      Producer: 'Memour',
    },
  })
  doc.registerFont('Manrope', fonts.manrope)
  doc.registerFont('Cormorant', fonts.cormorant)
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolveFn, rejectFn) => {
    doc.on('end', () => resolveFn(Buffer.concat(chunks)))
    doc.on('error', rejectFn)
  })

  // The logo is converted once (SVG / WebP → PNG, pdfkit only embeds
  // PNG / JPEG) and embedded once; every card references the same
  // image object.
  // (openImage isn't in @types/pdfkit, hence the casts.)
  let logo: unknown = null
  if (style.logo) {
    try {
      const png = await sharp(style.logo)
        .resize(600, 600, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
        .png()
        .toBuffer()
      logo = (doc as any).openImage(png)
    } catch (e) {
      console.error('[qr-pdf] logo decode failed — printing without it', e)
    }
  }

  const tableCount = Math.max(1, ev.table_count ?? 10)
  const pageW = doc.page.width
  const pageH = doc.page.height
  const colW = (pageW - L.margin * 2 - (L.cols - 1) * L.gap) / L.cols
  const rowH = (pageH - L.margin * 2 - (L.rows - 1) * L.gap) / L.rows
  const perPage = L.cols * L.rows
  const isSingle = L.cols === 1

  // ── Measure the text block once — names are the same on every card,
  // so every QR on the sheet gets the same size.
  const lineH = (font: string, size: number) => doc.font(font).fontSize(size).currentLineHeight(true)
  const tableH = lineH('Cormorant', L.type.table)
  const textW = colW - 2 * L.sideInset
  let names = ''
  let namesH = 0
  let dateStr = ''
  let dateH = 0
  let hintH = 0
  let hintSize = L.type.hint
  const gaps = { afterQr: L.decorative ? 22 : 6, names: isSingle ? 6 : 2, date: isSingle ? 6 : 3, hint: isSingle ? 10 : 6, bottom: L.decorative ? 14 : 6 }
  if (L.decorative) {
    doc.font('Cormorant').fontSize(L.type.names)
    names = printable(doc, ev.couple_names)
    const nameLine = doc.currentLineHeight(true)
    const lines = Math.max(1, Math.round(doc.heightOfString(names || ' ', { width: textW }) / nameLine))
    namesH = Math.min(lines, NAMES_MAX_LINES) * nameLine
    dateStr = formatCardDate(ev.wedding_date, lang)
    dateH = lineH('Cormorant', L.type.date)
    // Shrink the hint rather than wrap it if a language runs long.
    doc.font('Cormorant').fontSize(hintSize)
    hintSize = Math.min(hintSize, (hintSize * textW) / doc.widthOfString(text.hint))
    hintH = lineH('Cormorant', hintSize)
  }
  const textBlockH = L.decorative
    ? gaps.afterQr + tableH + gaps.names + namesH + gaps.date + dateH + gaps.hint + hintH + gaps.bottom
    : gaps.afterQr + tableH + gaps.bottom
  const qrSize = Math.floor(Math.min(colW - 2 * L.sideInset, rowH - L.qrTop - textBlockH))

  for (let t = 1; t <= tableCount; t++) {
    const indexOnPage = (t - 1) % perPage
    if (t > 1 && indexOnPage === 0) doc.addPage({ size: 'A4', margin: 0 })
    const col = indexOnPage % L.cols
    const row = Math.floor(indexOnPage / L.cols)
    const x = L.margin + col * (colW + L.gap)
    const y = L.margin + row * (rowH + L.gap)

    if (L.decorative) {
      doc.save()
      doc.roundedRect(x, y, colW, rowH, 14).fillAndStroke(style.bg, '#e8d8c6')
      doc.restore()
      // Top "MEMOUR" eyebrow stays in the sans-serif so the wedding
      // text below it has more visual weight.
      doc.font('Manrope').fillColor('#7a5444').fontSize(9)
      doc.text('MEMOUR', x, y + 14, {
        width: colW, height: lineH('Manrope', 9), align: 'center', characterSpacing: 2, lineBreak: false,
      })
    }

    // When the width caps the QR (the one-per-page layout), centre the
    // QR + text group in the space left under the eyebrow.
    const slack = Math.max(0, rowH - L.qrTop - qrSize - textBlockH)
    const qrX = x + (colW - qrSize) / 2
    const qrY = y + L.qrTop + slack / 2
    drawQr(doc, tableUrl(opts.siteUrl, lang, ev.id, t), style, logo, qrX, qrY, qrSize)

    let ty = qrY + qrSize
    if (L.decorative) {
      // Gold hairline divider between QR and text — gives the card
      // the "save the date" feel even at a glance.
      const divY = ty + 12
      const divW = Math.min(colW * 0.4, 80)
      doc.save()
      doc.lineWidth(0.6).strokeColor('#c89e6a')
      doc.moveTo(x + (colW - divW) / 2, divY).lineTo(x + (colW + divW) / 2, divY).stroke()
      doc.restore()
    }
    ty += gaps.afterQr

    // Table number — serif italic, the hero text on the card.
    doc.font('Cormorant').fillColor('#3a2010').fontSize(L.type.table)
    doc.text(text.table(t), x, ty, { width: colW, height: tableH, align: 'center', lineBreak: false })
    ty += tableH

    if (L.decorative) {
      // Couple names directly below, smaller serif italic; wraps up to
      // three lines, then ellipsis.
      ty += gaps.names
      doc.font('Cormorant').fillColor('#7a5444').fontSize(L.type.names)
      doc.text(names, x + L.sideInset, ty, { width: textW, height: namesH, align: 'center', ellipsis: true })
      ty += namesH + gaps.date

      // Wedding date in soft taupe, slightly looser tracking.
      doc.font('Cormorant').fillColor('#a48068').fontSize(L.type.date)
      doc.text(dateStr, x, ty, { width: colW, height: dateH, align: 'center', characterSpacing: 0.5, lineBreak: false })
      ty += dateH + gaps.hint

      // One-line instruction for guests who've never seen a table QR.
      doc.font('Cormorant').fillColor('#7a5444').fontSize(hintSize)
      doc.text(text.hint, x + L.sideInset, ty, { width: textW, height: hintH, align: 'center', lineBreak: false })
    }
  }

  doc.end()
  return done
}

/**
 * Resolve the event's style (saved qr_settings + `query` overrides),
 * render the PDF and set the download headers. `supabase` must be a
 * service-role client (the logo lives in the `branding` bucket).
 */
export async function sendQrPdf(
  h3: H3Event,
  supabase: ReturnType<typeof serverSupabaseServiceRole<Database>>,
  ev: QrPdfEvent & { qr_settings: unknown },
  query: Record<string, unknown>,
): Promise<Buffer> {
  const settings = resolveQrSettings(ev.qr_settings, query)
  const style: QRStyle = { ...settings.style }

  // Pull the logo if any.
  const logoPath = (ev.qr_settings as any)?.logo_path
  if (typeof logoPath === 'string' && logoPath) {
    const { data: blob } = await supabase.storage.from('branding').download(logoPath)
    if (blob) style.logo = Buffer.from(await blob.arrayBuffer())
  }

  const pdf = await renderQrPdf({
    event: ev,
    style,
    layout: settings.layout,
    lang: settings.lang,
    siteUrl: useRuntimeConfig().public.siteUrl,
  })

  // Self-identifying filename: "<couple names> <YYYY-MM-DD>.pdf".
  // When several QR PDFs are downloaded (multiple weddings), they can
  // be told apart in the Downloads folder at a glance.
  const namePart = (ev.couple_names || 'event').slice(0, 60).trim()
  const datePart = ev.wedding_date // already YYYY-MM-DD from the DB
  const utf8Name = `${namePart} ${datePart}.pdf`
  // ASCII fallback for old downloaders that ignore filename* — keep
  // the same shape but transliterate non-Latin chars to underscores.
  const asciiBody = namePart.replace(/[^a-z0-9 ]/gi, '_').replace(/_+/g, '_').trim()
  const asciiName = `${asciiBody || 'event'} ${datePart}.pdf`
  setResponseHeader(h3, 'Content-Type', 'application/pdf')
  setResponseHeader(
    h3,
    'Content-Disposition',
    `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
  )
  setResponseHeader(h3, 'Content-Length', pdf.length)
  setResponseHeader(h3, 'Cache-Control', 'private, no-store')
  return pdf
}
