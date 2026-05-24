import QRCode from 'qrcode'
import sharp from 'sharp'

/**
 * Custom QR-code renderer: reads the cell matrix from `qrcode`, emits
 * styled SVG with configurable shapes / colors / gradients / center
 * logo, then rasterises to PNG via sharp for PDF embedding.
 *
 * Gradient support: when `gradient` is set, dots and finder shapes
 * fill with an SVG linearGradient instead of a solid color.
 *
 * Logo support: a `logo` Buffer (PNG/JPEG) gets embedded centred on
 * the QR; the matrix uses error-correction level 'H', so up to ~30%
 * of pixels can be obscured without breaking scans.
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

function dotPath(
  shape: DotShape,
  px: number,
  py: number,
  s: number,
  fill: string,
): string {
  switch (shape) {
    case 'square':
      return `<rect x="${px}" y="${py}" width="${s}" height="${s}" fill="${fill}"/>`
    case 'rounded': {
      const inset = s * 0.1
      return `<rect x="${px + inset}" y="${py + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${s * 0.28}" fill="${fill}"/>`
    }
    case 'circle':
      return `<circle cx="${px + s / 2}" cy="${py + s / 2}" r="${s * 0.42}" fill="${fill}"/>`
    case 'classy': {
      const inset = s * 0.08
      return `<rect x="${px + inset}" y="${py + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${s * 0.42}" fill="${fill}"/>`
    }
  }
}

function finderPath(
  shape: CornerShape,
  cx: number,
  cy: number,
  cellSize: number,
  fill: string,
  bg: string,
): string {
  const size = 7 * cellSize
  switch (shape) {
    case 'square':
      return (
        `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" fill="${fill}"/>` +
        `<rect x="${cx + cellSize}" y="${cy + cellSize}" width="${size - 2 * cellSize}" height="${size - 2 * cellSize}" fill="${bg}"/>` +
        `<rect x="${cx + 2 * cellSize}" y="${cy + 2 * cellSize}" width="${size - 4 * cellSize}" height="${size - 4 * cellSize}" fill="${fill}"/>`
      )
    case 'rounded': {
      const r1 = size * 0.22
      const r2 = (size - 2 * cellSize) * 0.22
      const r3 = (size - 4 * cellSize) * 0.22
      return (
        `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" rx="${r1}" fill="${fill}"/>` +
        `<rect x="${cx + cellSize}" y="${cy + cellSize}" width="${size - 2 * cellSize}" height="${size - 2 * cellSize}" rx="${r2}" fill="${bg}"/>` +
        `<rect x="${cx + 2 * cellSize}" y="${cy + 2 * cellSize}" width="${size - 4 * cellSize}" height="${size - 4 * cellSize}" rx="${r3}" fill="${fill}"/>`
      )
    }
    case 'circle': {
      const r1 = size / 2
      const r2 = r1 - cellSize
      const r3 = r1 - 2 * cellSize
      const ccx = cx + r1
      const ccy = cy + r1
      return (
        `<circle cx="${ccx}" cy="${ccy}" r="${r1}" fill="${fill}"/>` +
        `<circle cx="${ccx}" cy="${ccy}" r="${r2}" fill="${bg}"/>` +
        `<circle cx="${ccx}" cy="${ccy}" r="${r3}" fill="${fill}"/>`
      )
    }
    case 'leaf': {
      const r = size * 0.3
      const outerD =
        `M ${cx} ${cy} L ${cx + size - r} ${cy} ` +
        `A ${r} ${r} 0 0 1 ${cx + size} ${cy + r} ` +
        `L ${cx + size} ${cy + size - r} ` +
        `A ${r} ${r} 0 0 1 ${cx + size - r} ${cy + size} ` +
        `L ${cx + r} ${cy + size} ` +
        `A ${r} ${r} 0 0 1 ${cx} ${cy + size - r} Z`
      const innerR = (size - 2 * cellSize) * 0.3
      const ix = cx + cellSize, iy = cy + cellSize, iw = size - 2 * cellSize
      const innerD =
        `M ${ix} ${iy} L ${ix + iw - innerR} ${iy} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix + iw} ${iy + innerR} ` +
        `L ${ix + iw} ${iy + iw - innerR} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix + iw - innerR} ${iy + iw} ` +
        `L ${ix + innerR} ${iy + iw} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix} ${iy + iw - innerR} Z`
      const dotR = (size - 4 * cellSize) * 0.3
      const dx = cx + 2 * cellSize, dy = cy + 2 * cellSize, dw = size - 4 * cellSize
      const dotD =
        `M ${dx} ${dy} L ${dx + dw - dotR} ${dy} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx + dw} ${dy + dotR} ` +
        `L ${dx + dw} ${dy + dw - dotR} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx + dw - dotR} ${dy + dw} ` +
        `L ${dx + dotR} ${dy + dw} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx} ${dy + dw - dotR} Z`
      return (
        `<path d="${outerD}" fill="${fill}"/>` +
        `<path d="${innerD}" fill="${bg}"/>` +
        `<path d="${dotD}" fill="${fill}"/>`
      )
    }
  }
}

export function renderStyledQRSVG(text: string, style: QRStyle, pxSize: number): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
  const modules: any = qr.modules
  const n = modules.size
  const cellSize = pxSize / n

  // If we're embedding a logo, clear ~22% of the central cells (safe
  // under EC level H which can recover ~30%). cellsCovered must be
  // ODD so the logo sits exactly centered.
  const hasLogo = !!style.logo
  let logoCells = 0
  if (hasLogo) {
    logoCells = Math.floor(n * 0.22)
    if (logoCells % 2 === 0) logoCells += 1
  }

  // Build the fill — either solid `fg` or a gradient ref.
  let defs = ''
  let fill = style.fg
  if (style.gradient) {
    const id = 'qrGrad'
    const a = (style.gradient.angle ?? 45) * (Math.PI / 180)
    const x1 = 50 - Math.cos(a) * 50
    const y1 = 50 - Math.sin(a) * 50
    const x2 = 50 + Math.cos(a) * 50
    const y2 = 50 + Math.sin(a) * 50
    defs = `<defs><linearGradient id="${id}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">` +
      `<stop offset="0%" stop-color="${style.gradient.from}"/>` +
      `<stop offset="100%" stop-color="${style.gradient.to}"/>` +
      `</linearGradient></defs>`
    fill = `url(#${id})`
  }

  let svg = `<svg width="${pxSize}" height="${pxSize}" viewBox="0 0 ${pxSize} ${pxSize}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">`
  svg += defs
  svg += `<rect width="${pxSize}" height="${pxSize}" fill="${style.bg}"/>`

  // Data cells
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(x, y)) continue
      if (isFinder(x, y, n)) continue
      if (hasLogo && isUnderLogo(x, y, n, logoCells)) continue
      svg += dotPath(style.dot, x * cellSize, y * cellSize, cellSize, fill)
    }
  }

  // Finder patterns
  svg += finderPath(style.corner, 0, 0, cellSize, fill, style.bg)
  svg += finderPath(style.corner, (n - 7) * cellSize, 0, cellSize, fill, style.bg)
  svg += finderPath(style.corner, 0, (n - 7) * cellSize, cellSize, fill, style.bg)

  svg += '</svg>'
  return svg
}

export async function renderStyledQRPng(
  text: string,
  style: QRStyle,
  pxSize: number,
): Promise<Buffer> {
  // Rasterise the SVG first.
  const svg = renderStyledQRSVG(text, style, pxSize)
  let img = sharp(Buffer.from(svg))

  // Overlay the logo centered on top, if provided.
  if (style.logo) {
    const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
    const n = (qr.modules as any).size
    const cellSize = pxSize / n
    let logoCells = Math.floor(n * 0.22)
    if (logoCells % 2 === 0) logoCells += 1
    const logoPx = Math.round(logoCells * cellSize * 0.85) // little inner padding
    const logoBuf = await sharp(style.logo)
      .resize(logoPx, logoPx, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer()
    img = sharp(await img.png().toBuffer())
      .composite([{ input: logoBuf, gravity: 'center' }])
  }

  return img.png({ compressionLevel: 6 }).toBuffer()
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
