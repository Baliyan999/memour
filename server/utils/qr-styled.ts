import QRCode from 'qrcode'
import sharp from 'sharp'

/**
 * Custom QR-code renderer that produces a styled SVG (then rasterized
 * to PNG via sharp). We avoid heavy browser-targeted libs like
 * qr-code-styling that need JSDOM in Node — instead we read the cell
 * matrix from the standard `qrcode` package and emit our own SVG with
 * configurable shapes per cell and custom finder-pattern drawing.
 *
 * The shape choices mirror the popular "QR generator" sites:
 *   • dot:    square | rounded | circle | classy (squircle)
 *   • corner: square | rounded | circle | leaf
 *   • colors: free-form hex pair (foreground + background)
 */

export type DotShape = 'square' | 'rounded' | 'circle' | 'classy'
export type CornerShape = 'square' | 'rounded' | 'circle' | 'leaf'

export interface QRStyle {
  dot: DotShape
  corner: CornerShape
  fg: string
  bg: string
}

const FINDER_SIZE = 7

function isFinder(x: number, y: number, n: number): boolean {
  if (x < FINDER_SIZE && y < FINDER_SIZE) return true
  if (x >= n - FINDER_SIZE && y < FINDER_SIZE) return true
  if (x < FINDER_SIZE && y >= n - FINDER_SIZE) return true
  return false
}

function dotPath(
  shape: DotShape,
  px: number,
  py: number,
  s: number,
  fg: string,
): string {
  switch (shape) {
    case 'square':
      return `<rect x="${px}" y="${py}" width="${s}" height="${s}" fill="${fg}"/>`
    case 'rounded': {
      const inset = s * 0.1
      return `<rect x="${px + inset}" y="${py + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${s * 0.28}" fill="${fg}"/>`
    }
    case 'circle': {
      return `<circle cx="${px + s / 2}" cy="${py + s / 2}" r="${s * 0.42}" fill="${fg}"/>`
    }
    case 'classy': {
      // squircle-ish: heavily rounded square
      const inset = s * 0.08
      return `<rect x="${px + inset}" y="${py + inset}" width="${s - 2 * inset}" height="${s - 2 * inset}" rx="${s * 0.42}" fill="${fg}"/>`
    }
  }
}

function finderPath(
  shape: CornerShape,
  cx: number,
  cy: number,
  cellSize: number,
  fg: string,
  bg: string,
): string {
  const size = 7 * cellSize
  switch (shape) {
    case 'square':
      return (
        `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" fill="${fg}"/>` +
        `<rect x="${cx + cellSize}" y="${cy + cellSize}" width="${size - 2 * cellSize}" height="${size - 2 * cellSize}" fill="${bg}"/>` +
        `<rect x="${cx + 2 * cellSize}" y="${cy + 2 * cellSize}" width="${size - 4 * cellSize}" height="${size - 4 * cellSize}" fill="${fg}"/>`
      )
    case 'rounded': {
      const r1 = size * 0.22
      const r2 = (size - 2 * cellSize) * 0.22
      const r3 = (size - 4 * cellSize) * 0.22
      return (
        `<rect x="${cx}" y="${cy}" width="${size}" height="${size}" rx="${r1}" fill="${fg}"/>` +
        `<rect x="${cx + cellSize}" y="${cy + cellSize}" width="${size - 2 * cellSize}" height="${size - 2 * cellSize}" rx="${r2}" fill="${bg}"/>` +
        `<rect x="${cx + 2 * cellSize}" y="${cy + 2 * cellSize}" width="${size - 4 * cellSize}" height="${size - 4 * cellSize}" rx="${r3}" fill="${fg}"/>`
      )
    }
    case 'circle': {
      const r1 = size / 2
      const r2 = r1 - cellSize
      const r3 = r1 - 2 * cellSize
      const ccx = cx + r1
      const ccy = cy + r1
      return (
        `<circle cx="${ccx}" cy="${ccy}" r="${r1}" fill="${fg}"/>` +
        `<circle cx="${ccx}" cy="${ccy}" r="${r2}" fill="${bg}"/>` +
        `<circle cx="${ccx}" cy="${ccy}" r="${r3}" fill="${fg}"/>`
      )
    }
    case 'leaf': {
      // Top-left corner pointed, others rounded — gives a "leaf" feel
      const r = size * 0.3
      // Outer: rounded square with one square corner (top-left)
      const outerD =
        `M ${cx} ${cy} ` +
        `L ${cx + size - r} ${cy} ` +
        `A ${r} ${r} 0 0 1 ${cx + size} ${cy + r} ` +
        `L ${cx + size} ${cy + size - r} ` +
        `A ${r} ${r} 0 0 1 ${cx + size - r} ${cy + size} ` +
        `L ${cx + r} ${cy + size} ` +
        `A ${r} ${r} 0 0 1 ${cx} ${cy + size - r} ` +
        `Z`
      const innerR = (size - 2 * cellSize) * 0.3
      const ix = cx + cellSize
      const iy = cy + cellSize
      const iw = size - 2 * cellSize
      const innerD =
        `M ${ix} ${iy} ` +
        `L ${ix + iw - innerR} ${iy} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix + iw} ${iy + innerR} ` +
        `L ${ix + iw} ${iy + iw - innerR} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix + iw - innerR} ${iy + iw} ` +
        `L ${ix + innerR} ${iy + iw} ` +
        `A ${innerR} ${innerR} 0 0 1 ${ix} ${iy + iw - innerR} Z`
      const dotR = (size - 4 * cellSize) * 0.3
      const dx = cx + 2 * cellSize
      const dy = cy + 2 * cellSize
      const dw = size - 4 * cellSize
      const dotD =
        `M ${dx} ${dy} ` +
        `L ${dx + dw - dotR} ${dy} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx + dw} ${dy + dotR} ` +
        `L ${dx + dw} ${dy + dw - dotR} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx + dw - dotR} ${dy + dw} ` +
        `L ${dx + dotR} ${dy + dw} ` +
        `A ${dotR} ${dotR} 0 0 1 ${dx} ${dy + dw - dotR} Z`
      return (
        `<path d="${outerD}" fill="${fg}"/>` +
        `<path d="${innerD}" fill="${bg}"/>` +
        `<path d="${dotD}" fill="${fg}"/>`
      )
    }
  }
}

/** Render a QR with the given style to an SVG string (vector). */
export function renderStyledQRSVG(
  text: string,
  style: QRStyle,
  pxSize: number,
): string {
  // High error correction so logos / heavy styling don't break scans.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' })
  const modules: any = qr.modules
  const n = modules.size
  const cellSize = pxSize / n

  let svg = `<svg width="${pxSize}" height="${pxSize}" viewBox="0 0 ${pxSize} ${pxSize}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">`
  svg += `<rect width="${pxSize}" height="${pxSize}" fill="${style.bg}"/>`

  // Data cells (skip finder regions; we draw them separately)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(x, y)) continue
      if (isFinder(x, y, n)) continue
      svg += dotPath(style.dot, x * cellSize, y * cellSize, cellSize, style.fg)
    }
  }

  // Three finder patterns
  svg += finderPath(style.corner, 0, 0, cellSize, style.fg, style.bg)
  svg += finderPath(style.corner, (n - 7) * cellSize, 0, cellSize, style.fg, style.bg)
  svg += finderPath(style.corner, 0, (n - 7) * cellSize, cellSize, style.fg, style.bg)

  svg += '</svg>'
  return svg
}

/** Render a styled QR and rasterize to PNG buffer for PDFKit embedding. */
export async function renderStyledQRPng(
  text: string,
  style: QRStyle,
  pxSize: number,
): Promise<Buffer> {
  const svg = renderStyledQRSVG(text, style, pxSize)
  return sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer()
}

// Preset bundles — what the admin UI exposes as a single "look".
export interface QRPreset {
  id: string
  label: string
  style: QRStyle
}

export const QR_PRESETS: QRPreset[] = [
  {
    id: 'mono',
    label: 'Классика',
    style: { dot: 'square', corner: 'square', fg: '#3a2010', bg: '#fbf6f0' },
  },
  {
    id: 'rounded',
    label: 'Скруглённый',
    style: { dot: 'rounded', corner: 'rounded', fg: '#3a2010', bg: '#fbf6f0' },
  },
  {
    id: 'dots',
    label: 'Точки',
    style: { dot: 'circle', corner: 'circle', fg: '#7a5444', bg: '#fbf6f0' },
  },
  {
    id: 'classy',
    label: 'Бусины',
    style: { dot: 'classy', corner: 'rounded', fg: '#3a2010', bg: '#fbf6f0' },
  },
  {
    id: 'leaf',
    label: 'Лепесток',
    style: { dot: 'rounded', corner: 'leaf', fg: '#7a5444', bg: '#fbf6f0' },
  },
  {
    id: 'gold',
    label: 'Золото',
    style: { dot: 'circle', corner: 'rounded', fg: '#9c7440', bg: '#fff8ee' },
  },
  {
    id: 'rose',
    label: 'Роза',
    style: { dot: 'rounded', corner: 'leaf', fg: '#b85c5c', bg: '#fff1ee' },
  },
  {
    id: 'midnight',
    label: 'Полночь',
    style: { dot: 'square', corner: 'square', fg: '#1a1a1a', bg: '#ffffff' },
  },
]

export function getPreset(id?: string | null): QRPreset {
  return QR_PRESETS.find((p) => p.id === id) ?? QR_PRESETS[0]!
}
