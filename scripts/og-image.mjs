#!/usr/bin/env node
/**
 * og-image — the 1200×630 picture social networks and messengers show
 * for a link to memour.uz (og:image / twitter:image, wired in app.vue).
 *
 *   node scripts/og-image.mjs                  # writes public/og-image.jpg
 *   node scripts/og-image.mjs --svg=/tmp/og.svg  # also the source SVG, for review (keep it out of public/)
 *
 * One language-neutral image for both locales: the logo, the wordmark
 * and the address, between two guest photos set as polaroids — the
 * same paper frames the live slideshow uses. Nothing to translate, so
 * /uz and /ru share it (the alt text is localized, app.vue).
 *
 * Everything comes from the repo, so a re-run gives the same file:
 *   - palette: the oklch tokens in app/assets/css/main.css, converted
 *     to sRGB here;
 *   - type: Cormorant Garamond and Manrope from @fontsource, set as
 *     outlines with fontkit (already installed with pdfkit) — the SVG
 *     renderer never has to find a font on the machine;
 *   - the mark: public/memour-logo.png; photos: assets-src/images.
 * sharp renders the SVG and writes a JPEG (< 300 KB). Re-run after
 * changing the brand tokens, the logo or the photos and commit the
 * output.
 */
import sharp from 'sharp'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public/og-image.jpg')
const W = 1200
const H = 630
const MAX_BYTES = 300 * 1024

const require = createRequire(import.meta.url)
const fontkit = createRequire(require.resolve('pdfkit'))('fontkit')
const fontFile = (pkg, file) => join(dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files', file)

// ─── Palette: the brand tokens, oklch → sRGB ────────────────────────────
const css = readFileSync(join(ROOT, 'app/assets/css/main.css'), 'utf8')
function token(name) {
  const m = new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)%\\s+([\\d.]+)\\s+([\\d.]+)\\)`).exec(css)
  if (!m) throw new Error(`token --color-${name} not found in main.css`)
  return oklchToHex(Number(m[1]) / 100, Number(m[2]), Number(m[3]))
}
function oklchToHex(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return '#' + lin.map((x) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  }).join('')
}
const C = {
  background: token('background'),
  foreground: token('foreground'),
  muted: token('muted-foreground'),
  primary: token('primary'),
  accent: token('accent'),
  rose: token('rose'),
  champagne: token('champagne'),
  paper: token('primary-foreground'),
}

// ─── Type as outlines ──────────────────────────────────────────────────
const fonts = {
  display: fontkit.openSync(fontFile('cormorant-garamond', 'cormorant-garamond-latin-500-normal.woff2')),
  sans: fontkit.openSync(fontFile('manrope', 'manrope-latin-500-normal.woff2')),
}
/** One line of text as <path>s; x is the centre unless anchor is 'start'. */
function text(font, str, { size, x, y, tracking = 0, fill, anchor = 'middle' }) {
  const run = font.layout(str)
  const k = size / font.unitsPerEm
  const width = run.positions.reduce((w, p) => w + p.xAdvance * k, 0) + tracking * (run.glyphs.length - 1)
  let pen = anchor === 'middle' ? x - width / 2 : x
  const paths = []
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i]
    const d = g.path.toSVG()
    if (d) {
      const tx = (pen + p.xOffset * k).toFixed(2)
      const ty = (y - p.yOffset * k).toFixed(2)
      paths.push(`<path transform="translate(${tx} ${ty}) scale(${k.toFixed(5)} ${(-k).toFixed(5)})" d="${d}"/>`)
    }
    pen += p.xAdvance * k + tracking
  })
  return { svg: `<g fill="${fill}">${paths.join('')}</g>`, width }
}

// ─── Photos as polaroids ───────────────────────────────────────────────
async function photo(name, size, position = 'centre') {
  const buf = await sharp(join(ROOT, 'assets-src/images', `${name}.webp`))
    .resize(size * 2, size * 2, { fit: 'cover', position })
    .modulate({ saturation: 0.92 })
    .jpeg({ quality: 90 })
    .toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}
/** A paper frame with a square photo, centred on (cx, cy), turned by `deg`. */
async function polaroid({ name, cx, cy, deg, size, position }) {
  const pad = Math.round(size * 0.075)
  const w = size + pad * 2
  const h = size + pad * 2 + Math.round(size * 0.2)
  const href = await photo(name, size, position)
  return `
  <g transform="translate(${cx} ${cy}) rotate(${deg})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="${C.paper}" filter="url(#lift)"/>
    <image href="${href}" x="${-w / 2 + pad}" y="${-h / 2 + pad}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="${-w / 2 + pad}" y="${-h / 2 + pad}" width="${size}" height="${size}" fill="none" stroke="#000" stroke-opacity="0.06"/>
  </g>`
}

// ─── Composition ───────────────────────────────────────────────────────
const logo = `data:image/png;base64,${readFileSync(join(ROOT, 'public/memour-logo.png')).toString('base64')}`

const wordmark = text(fonts.display, 'Memour', { size: 132, x: W / 2, y: 382, fill: C.foreground, tracking: 1 })
const domain = text(fonts.sans, 'MEMOUR.UZ', { size: 17, x: W / 2, y: 470, fill: C.muted, tracking: 6.5 })

const photos = (await Promise.all([
  // left: a quiet frame behind, the first dance in front
  polaroid({ name: 'candles-table', cx: 160, cy: 246, deg: -10, size: 184 }),
  polaroid({ name: 'dance-slow', cx: 200, cy: 374, deg: -3.5, size: 216, position: 'north' }),
  // right: flowers behind, sparklers in front
  polaroid({ name: 'bouquet', cx: 1044, cy: 242, deg: 9, size: 184 }),
  polaroid({ name: 'sparklers', cx: 1000, cy: 378, deg: 4, size: 216 }),
])).join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="42%" r="62%">
      <stop offset="0" stop-color="${C.champagne}" stop-opacity="0.7"/>
      <stop offset="0.55" stop-color="${C.background}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blush" cx="50%" cy="115%" r="70%">
      <stop offset="0" stop-color="${C.rose}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="${C.rose}" stop-opacity="0"/>
    </radialGradient>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="170%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="14" result="blur"/>
      <feFlood flood-color="#6b3f2a" flood-opacity="0.22"/>
      <feComposite in2="blur" operator="in" result="shadow"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="edge"/>
      <feFlood flood-color="#6b3f2a" flood-opacity="0.18"/>
      <feComposite in2="edge" operator="in" result="contact"/>
      <feMerge><feMergeNode in="shadow"/><feMergeNode in="contact"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.background}"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect width="${W}" height="${H}" fill="url(#blush)"/>

  <!-- invitation-card hairline; the photos lie on top of the card -->
  <rect x="24.5" y="24.5" width="${W - 49}" height="${H - 49}" rx="14" fill="none" stroke="${C.primary}" stroke-opacity="0.28"/>

  ${photos}

  <image href="${logo}" x="${W / 2 - 46}" y="158" width="92" height="92"/>
  ${wordmark.svg}
  <g stroke="${C.primary}" stroke-opacity="0.55" stroke-width="1">
    <line x1="${W / 2 - 74}" y1="424.5" x2="${W / 2 - 12}" y2="424.5"/>
    <line x1="${W / 2 + 12}" y1="424.5" x2="${W / 2 + 74}" y2="424.5"/>
  </g>
  <circle cx="${W / 2}" cy="424.5" r="2.6" fill="${C.primary}" fill-opacity="0.75"/>
  ${domain.svg}
</svg>`

const jpeg = await sharp(Buffer.from(svg), { density: 72 })
  .flatten({ background: C.background })
  .jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' })
  .toBuffer()
const meta = await sharp(jpeg).metadata()
if (meta.width !== W || meta.height !== H) throw new Error(`rendered ${meta.width}×${meta.height}, expected ${W}×${H}`)
if (jpeg.length > MAX_BYTES) throw new Error(`og-image is ${Math.round(jpeg.length / 1024)} KB, over ${MAX_BYTES / 1024} KB`)
writeFileSync(OUT, jpeg)
const svgOut = process.argv.find((a) => a.startsWith('--svg='))?.slice('--svg='.length)
if (svgOut) writeFileSync(svgOut, svg)
console.log(`public/og-image.jpg  ${W}×${H}  ${Math.round(statSync(OUT).size / 1024)} KB  palette ${JSON.stringify(C)}`)
