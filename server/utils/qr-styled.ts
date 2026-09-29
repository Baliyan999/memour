import QRCode from 'qrcode'
import { z } from 'zod'

/**
 * Custom QR-code renderer: reads the cell matrix from `qrcode` and
 * turns it into a list of vector shapes with configurable dot / corner
 * shapes, colors, gradient and a cleared center for a logo.
 *
 * The same shape list feeds two outputs, so the admin preview and the
 * printed PDF can never drift apart:
 *   - renderStyledQRSVG — the SVG the admin preview shows;
 *   - qr-pdf.ts draws the shapes straight into pdfkit as vector paths
 *     (crisp at any print size, a few KB per card instead of a PNG).
 *
 * Gradient support: when `gradient` is set, dots and finder shapes
 * fill with one linear gradient spanning the whole code.
 *
 * Logo support: the matrix uses error-correction level 'H', so the
 * cells under a centered logo (~22% of the width) can be cleared
 * without breaking scans.
 */

export type DotShape = 'square' | 'rounded' | 'circle' | 'classy'
export type CornerShape = 'square' | 'rounded' | 'circle' | 'leaf'

export interface QRGradient {
  from: string
  to: string
  angle: number // degrees, 0 = horizontal
}

export interface QRStyle {
  dot: DotShape
  corner: CornerShape
  fg: string
  bg: string
  gradient?: QRGradient | null
  logo?: Buffer | null
}

/** One vector primitive, in the coordinate space of the QR box. */
export type QRShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; r: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'path'; d: string }

/** Shapes painted in order; `fill` says which color of the style to use. */
export interface QRLayer {
  fill: 'fg' | 'bg'
  shapes: QRShape[]
}

export interface QRGeometry {
  size: number
  layers: QRLayer[]
  /** Square left empty for the logo (null when there is no logo). */
  logoBox: { x: number; y: number; size: number } | null
}

const FINDER_SIZE = 7

function isFinder(x: number, y: number, n: number): boolean {
  if (x < FINDER_SIZE && y < FINDER_SIZE) return true
  if (x >= n - FINDER_SIZE && y < FINDER_SIZE) return true
  if (x < FINDER_SIZE && y >= n - FINDER_SIZE) return true
  return false
}

/**
 * For the optional center logo, we also clear the QR cells under
 * the logo's footprint so the QR doesn't poke through. With level
 * 'H' we can hide ~30% of cells safely.
 */
function isUnderLogo(x: number, y: number, n: number, logoCells: number): boolean {
  const mid = Math.floor(n / 2)
  const half = Math.floor(logoCells / 2)
  return Math.abs(x - mid) <= half && Math.abs(y - mid) <= half
}

// Round to 1/100 px — keeps the SVG / PDF content streams compact.
const r2 = (v: number) => Math.round(v * 100) / 100

function rect(x: number, y: number, w: number, h: number, r = 0): QRShape {
  return { kind: 'rect', x: r2(x), y: r2(y), w: r2(w), h: r2(h), r: r2(r) }
}

function dotShape(shape: DotShape, px: number, py: number, s: number): QRShape {
  switch (shape) {
    case 'rounded': {
      const inset = s * 0.1
      return rect(px + inset, py + inset, s - 2 * inset, s - 2 * inset, s * 0.28)
    }
    case 'circle':
      return { kind: 'circle', cx: r2(px + s / 2), cy: r2(py + s / 2), r: r2(s * 0.42) }
    case 'classy': {
      const inset = s * 0.08
      return rect(px + inset, py + inset, s - 2 * inset, s - 2 * inset, s * 0.42)
    }
    case 'square':
    default:
      // Unknown values fall back to squares — an unscannable blank
      // code is worse than a plain one.
      return rect(px, py, s, s)
  }
}

/** Rounded square with only the top-left corner sharp — the "leaf" eye. */
function leafPath(x: number, y: number, w: number, r: number): string {
  const [X, Y, W, R] = [r2(x), r2(y), r2(w), r2(r)]
  return (
    `M ${X} ${Y} L ${r2(X + W - R)} ${Y} ` +
    `A ${R} ${R} 0 0 1 ${r2(X + W)} ${r2(Y + R)} ` +
    `L ${r2(X + W)} ${r2(Y + W - R)} ` +
    `A ${R} ${R} 0 0 1 ${r2(X + W - R)} ${r2(Y + W)} ` +
    `L ${r2(X + R)} ${r2(Y + W)} ` +
    `A ${R} ${R} 0 0 1 ${X} ${r2(Y + W - R)} Z`
  )
}

/** The three nested squares of one finder: outer (fg), gap (bg), eye (fg). */
function finderShapes(shape: CornerShape, cx: number, cy: number, cell: number): [QRShape, QRShape, QRShape] {
  const size = 7 * cell
  const inner = size - 2 * cell
  const eye = size - 4 * cell
  switch (shape) {
    case 'rounded':
      return [
        rect(cx, cy, size, size, size * 0.22),
        rect(cx + cell, cy + cell, inner, inner, inner * 0.22),
        rect(cx + 2 * cell, cy + 2 * cell, eye, eye, eye * 0.22),
      ]
    case 'circle': {
      const r1 = size / 2
      const c = { x: r2(cx + r1), y: r2(cy + r1) }
      return [
        { kind: 'circle', cx: c.x, cy: c.y, r: r2(r1) },
        { kind: 'circle', cx: c.x, cy: c.y, r: r2(r1 - cell) },
        { kind: 'circle', cx: c.x, cy: c.y, r: r2(r1 - 2 * cell) },
      ]
    }
    case 'leaf':
      return [
        { kind: 'path', d: leafPath(cx, cy, size, size * 0.3) },
        { kind: 'path', d: leafPath(cx + cell, cy + cell, inner, inner * 0.3) },
        { kind: 'path', d: leafPath(cx + 2 * cell, cy + 2 * cell, eye, eye * 0.3) },
      ]
    case 'square':
    default:
      return [
        rect(cx, cy, size, size),
        rect(cx + cell, cy + cell, inner, inner),
        rect(cx + 2 * cell, cy + 2 * cell, eye, eye),
      ]
  }
}

/**
 * Shapes for `text` in a `size` × `size` box. Pass `{ unitsPerModule }`
 * instead of a size to get whole-number coordinates (the PDF scales
 * them down with one transform — short numbers keep the file small).
 */
export function buildQRGeometry(
  text: string,
  style: Pick<QRStyle, 'dot' | 'corner'>,
  size: number | { unitsPerModule: number },
  withLogo: boolean,
): QRGeometry {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
  const modules = qr.modules
  const n = modules.size
  const cell = typeof size === 'number' ? size / n : size.unitsPerModule
  const boxSize = n * cell

  // With a logo, clear ~22% of the central cells (safe under EC level
  // H which can recover ~30%). The count must be ODD so the logo sits
  // exactly centered.
  let logoCells = 0
  if (withLogo) {
    logoCells = Math.floor(n * 0.22)
    if (logoCells % 2 === 0) logoCells += 1
  }

  const dots: QRShape[] = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // BitMatrix.get takes (row, col). Reading it as (x, y) drew the
      // code mirrored along its diagonal — most scanners cope, but not
      // every one has to.
      if (!modules.get(y, x)) continue
      if (isFinder(x, y, n)) continue
      if (withLogo && isUnderLogo(x, y, n, logoCells)) continue
      dots.push(dotShape(style.dot, x * cell, y * cell, cell))
    }
  }

  const layers: QRLayer[] = [{ fill: 'fg', shapes: dots }]
  for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    const [outer, gap, eye] = finderShapes(style.corner, fx * cell, fy * cell, cell)
    layers.push({ fill: 'fg', shapes: [outer] }, { fill: 'bg', shapes: [gap] }, { fill: 'fg', shapes: [eye] })
  }

  const logoBox = withLogo
    ? {
        x: (Math.floor(n / 2) - Math.floor(logoCells / 2)) * cell,
        y: (Math.floor(n / 2) - Math.floor(logoCells / 2)) * cell,
        size: logoCells * cell,
      }
    : null
  return { size: boxSize, layers, logoBox }
}

/** Gradient end points for an angle, in a size × size box. */
export function gradientVector(angleDeg: number, size: number) {
  const a = angleDeg * (Math.PI / 180)
  return {
    x1: r2(size / 2 - (Math.cos(a) * size) / 2),
    y1: r2(size / 2 - (Math.sin(a) * size) / 2),
    x2: r2(size / 2 + (Math.cos(a) * size) / 2),
    y2: r2(size / 2 + (Math.sin(a) * size) / 2),
  }
}

function shapeSvg(s: QRShape, fill: string): string {
  switch (s.kind) {
    case 'rect':
      return s.r > 0
        ? `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${fill}"/>`
        : `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${fill}"/>`
    case 'circle':
      return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${fill}"/>`
    case 'path':
      return `<path d="${s.d}" fill="${fill}"/>`
  }
}

export function renderStyledQRSVG(text: string, style: QRStyle, pxSize: number): string {
  const geo = buildQRGeometry(text, style, pxSize, !!style.logo)

  // Build the fill — either solid `fg` or one gradient over the whole
  // code (userSpaceOnUse, so it matches the PDF, which can't afford a
  // separate gradient per dot).
  let defs = ''
  let fg = style.fg
  if (style.gradient) {
    const v = gradientVector(style.gradient.angle ?? 45, pxSize)
    defs = `<defs><linearGradient id="qrGrad" gradientUnits="userSpaceOnUse" x1="${v.x1}" y1="${v.y1}" x2="${v.x2}" y2="${v.y2}">` +
      `<stop offset="0%" stop-color="${style.gradient.from}"/>` +
      `<stop offset="100%" stop-color="${style.gradient.to}"/>` +
      `</linearGradient></defs>`
    fg = 'url(#qrGrad)'
  }

  let svg = `<svg width="${pxSize}" height="${pxSize}" viewBox="0 0 ${pxSize} ${pxSize}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">`
  svg += defs
  svg += `<rect width="${pxSize}" height="${pxSize}" fill="${style.bg}"/>`
  for (const layer of geo.layers) {
    const fill = layer.fill === 'fg' ? fg : style.bg
    for (const s of layer.shapes) svg += shapeSvg(s, fill)
  }
  svg += '</svg>'
  return svg
}

// Preset bundles for the admin UI quick-picker.
export interface QRPreset {
  id: string
  label: string
  style: Omit<QRStyle, 'logo' | 'gradient'> & { gradient?: QRGradient | null }
}

export const QR_PRESETS: QRPreset[] = [
  { id: 'mono', label: 'Классика', style: { dot: 'square', corner: 'square', fg: '#3a2010', bg: '#fbf6f0' } },
  { id: 'rounded', label: 'Скруглённый', style: { dot: 'rounded', corner: 'rounded', fg: '#3a2010', bg: '#fbf6f0' } },
  { id: 'dots', label: 'Точки', style: { dot: 'circle', corner: 'circle', fg: '#7a5444', bg: '#fbf6f0' } },
  { id: 'classy', label: 'Бусины', style: { dot: 'classy', corner: 'rounded', fg: '#3a2010', bg: '#fbf6f0' } },
  { id: 'leaf', label: 'Лепесток', style: { dot: 'rounded', corner: 'leaf', fg: '#7a5444', bg: '#fbf6f0' } },
  { id: 'gold', label: 'Золото', style: { dot: 'circle', corner: 'rounded', fg: '#9c7440', bg: '#fff8ee' } },
  { id: 'rose', label: 'Роза', style: { dot: 'rounded', corner: 'leaf', fg: '#b85c5c', bg: '#fff1ee' } },
  { id: 'midnight', label: 'Полночь', style: { dot: 'square', corner: 'square', fg: '#1a1a1a', bg: '#ffffff' } },
  {
    id: 'gradient-gold',
    label: 'Градиент',
    style: {
      dot: 'rounded', corner: 'rounded', fg: '#3a2010', bg: '#fbf6f0',
      gradient: { from: '#9c7440', to: '#b85c5c', angle: 45 },
    },
  },
]

export function getPreset(id?: string | null): QRPreset {
  return QR_PRESETS.find((p) => p.id === id) ?? QR_PRESETS[0]!
}

// ── Settings (events.qr_settings) ─────────────────────────────────────
//
// One schema for what the admin can save and what the preview / PDF
// endpoints accept in the query string, so a hand-crafted URL can't
// smuggle markup into the SVG or pick shapes the renderer doesn't know.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const QR_STYLE_IDS = ['custom', ...QR_PRESETS.map((p) => p.id)] as [string, ...string[]]
export const QR_LAYOUT_IDS = ['2x2', '4x2', 'single'] as const
export const QR_LANGS = ['uz', 'ru'] as const
export type QrLayoutId = (typeof QR_LAYOUT_IDS)[number]
export type QrLang = (typeof QR_LANGS)[number]

const styleIdSchema = z.enum(QR_STYLE_IDS)
const layoutSchema = z.enum(QR_LAYOUT_IDS)
const langSchema = z.enum(QR_LANGS)
const dotSchema = z.enum(['square', 'rounded', 'circle', 'classy'])
const cornerSchema = z.enum(['square', 'rounded', 'circle', 'leaf'])
const gradientSchema = z.object({ from: hex, to: hex, angle: z.number().min(0).max(360) })

/** What POST /api/admin/qr-settings accepts (logo_path is server-set). */
export const qrSettingsSchema = z.object({
  style: styleIdSchema.optional(),
  layout: layoutSchema.optional(),
  lang: langSchema.optional(),
  dot: dotSchema.optional(),
  corner: cornerSchema.optional(),
  fg: hex.optional(),
  bg: hex.optional(),
  gradient: gradientSchema.nullable().optional(),
}).strict()

function pick<T>(schema: z.ZodType<T>, v: unknown): T | undefined {
  const r = schema.safeParse(v)
  return r.success ? r.data : undefined
}

export interface ResolvedQrSettings {
  styleId: string
  style: QRStyle
  layout: QrLayoutId
  lang: QrLang
}

/**
 * Merge the saved qr_settings with query-string overrides.
 *
 *   - A preset (`style=<id>`) is used exactly as defined — custom
 *     fields left over from an earlier "Свой стиль" save never leak
 *     into it.
 *   - Custom fields in the query (dot / corner / fg / bg / gFrom+gTo)
 *     mean "custom": they overlay the saved custom fields, and the
 *     gradient is on only if the query carries one.
 *   - Invalid values are ignored field by field.
 */
export function resolveQrSettings(
  saved: unknown,
  query: Record<string, unknown> = {},
): ResolvedQrSettings {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const q = query

  const qFrom = pick(hex, q.gFrom)
  const qTo = pick(hex, q.gTo)
  const qAngle = typeof q.gAngle === 'string' || typeof q.gAngle === 'number' ? Number(q.gAngle) : 45
  const qCustom = {
    dot: pick(dotSchema, q.dot),
    corner: pick(cornerSchema, q.corner),
    fg: pick(hex, q.fg),
    bg: pick(hex, q.bg),
    gradient: qFrom && qTo
      ? { from: qFrom, to: qTo, angle: Number.isFinite(qAngle) ? Math.min(360, Math.max(0, qAngle)) : 45 }
      : null,
  }
  const queryHasCustom = Object.values(qCustom).some((v) => v != null)
  const qStyle = pick(styleIdSchema, q.style)

  const styleId = qStyle ?? (queryHasCustom ? 'custom' : pick(styleIdSchema, s.style) ?? 'mono')

  let style: QRStyle
  if (styleId === 'custom') {
    const base = getPreset('mono').style
    style = {
      dot: qCustom.dot ?? pick(dotSchema, s.dot) ?? base.dot,
      corner: qCustom.corner ?? pick(cornerSchema, s.corner) ?? base.corner,
      fg: qCustom.fg ?? pick(hex, s.fg) ?? base.fg,
      bg: qCustom.bg ?? pick(hex, s.bg) ?? base.bg,
      gradient: queryHasCustom ? qCustom.gradient : (pick(gradientSchema, s.gradient) ?? null),
    }
  } else {
    const preset = getPreset(styleId)
    style = { ...preset.style, gradient: preset.style.gradient ?? null }
  }

  return {
    styleId,
    style,
    layout: pick(layoutSchema, q.layout) ?? pick(layoutSchema, s.layout) ?? '2x2',
    lang: pick(langSchema, q.lang) ?? pick(langSchema, s.lang) ?? 'uz',
  }
}
