#!/usr/bin/env node
/**
 * optimize-images — builds the responsive variants for the landing
 * photos from the masters in assets-src/images/ (at least 832 px
 * wide; bigger masters are downsized).
 *
 *   node scripts/optimize-images.mjs                 # (re)build every variant
 *   node scripts/optimize-images.mjs --import a.jpg name
 *                                                    # add a new master (webp q88)
 *
 * For every master `assets-src/images/<name>.webp` it writes
 * `public/images/<name>-400.webp`, `-640.webp` and `-832.webp` (webp
 * q78, never upscaled), plus the derived crops listed in CROPS below.
 * Slots that render far below 400 px (the photos inside the feature
 * mockups) get their own, smaller steps instead — see MOCK.
 * The masters live outside public/ so they never ship — components
 * reference the variants through MarketingPhoto, which reads
 * photo-manifest.json. Re-run after replacing or adding a master and
 * commit the output.
 */
import sharp from 'sharp'
import { readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'assets-src/images')
const OUT = join(ROOT, 'public/images')
const MANIFEST = join(ROOT, 'app/components/marketing/photo-manifest.json')
const WIDTHS = [400, 640, 832]
const QUALITY = 78

// Steps for the small photos inside the feature mockups (Mockup.vue),
// about 1×–3× the CSS width they render at.
const MOCK = {
  screen: [200, 320], // video phone screen (93 px) and swipe card (100–128 px)
  strip: [120, 192, 320], // projector thumbnails, 40–86 px once cover-scaled (to 155 px on a 3xl projector)
  album: [100], // Telegram album tiles, 33 px
}
// Masters shown whole, but only that small.
const SMALL = { 'mock-video-selfie': MOCK.screen }

// Crops cut from a master when the slot needs a different framing.
// Regions are in master pixels; `widths` replaces WIDTHS.
const CROPS = {
  // Features → the slideshow mockup is a 16:9 projector frame: a band of
  // the 1536×1024 landscape master that keeps the couple's heads below
  // the live bar and their feet and the veil above the thumbnail strip.
  // The projector grows to 600–1000 px on wide screens, so it gets the
  // master's full width too.
  'slideshow-hero-wide': { from: 'slideshow-hero', region: { left: 0, top: 144, width: 1536, height: 864 }, widths: [400, 640, 832, 1152, 1536] },
  // Swipe card (4:5): zoomed in on the three faces, low enough in the
  // frame that the ✓ badge in the top-right corner stays above them.
  'mock-moderation-card': { from: 'mock-moderation', region: { left: 200, top: 0, width: 860, height: 1075 }, widths: MOCK.screen },
  // Geofence map: centred on the path between the long table and the
  // tent, where the pin and the radius circle sit.
  'mock-venue-map': { from: 'mock-venue-aerial', region: { left: 364, top: 194, width: 1172, height: 732 } },
  // Projector thumbnails (≈ 2.2:1): the first is the photo on screen.
  'mock-strip-slideshow': { from: 'slideshow-hero', region: { left: 300, top: 220, width: 1056, height: 480 }, widths: MOCK.strip },
  'mock-strip-dance': { from: 'dance-slow', region: { left: 166, top: 90, width: 1034, height: 470 }, widths: MOCK.strip },
  'mock-strip-bouquet': { from: 'bouquet', region: { left: 0, top: 450, width: 1024, height: 465 }, widths: MOCK.strip },
  'mock-strip-sparklers': { from: 'sparklers', region: { left: 0, top: 300, width: 1024, height: 465 }, widths: MOCK.strip },
  'mock-strip-candles': { from: 'candles', region: { left: 0, top: 580, width: 1024, height: 465 }, widths: MOCK.strip },
  // Telegram album tiles (1:1).
  'mock-album-couple': { from: 'couple-back', region: { left: 130, top: 540, width: 800, height: 800 }, widths: MOCK.album },
  'mock-album-table': { from: 'table-setting', region: { left: 100, top: 450, width: 900, height: 900 }, widths: MOCK.album },
  'mock-album-first-look': { from: 'first-look', region: { left: 0, top: 60, width: 1024, height: 1024 }, widths: MOCK.album },
  'mock-album-champagne': { from: 'champagne', region: { left: 0, top: 250, width: 1024, height: 1024 }, widths: MOCK.album },
  // Sticky headline → the wide shot on the album page (3:2): the couple
  // walking through the sparklers, heads and shoulders in the upper third.
  'album-sparklers': { from: 'sparklers', region: { left: 0, top: 260, width: 1024, height: 683 } },
}

// Stats → the photo stack in the «up to 50 frames» tile: 3:4 cards,
// 56–143 px wide. Framed on the couple / the glass.
const DECK = [120, 200, 280]
Object.assign(CROPS, {
  'stats-deck-confetti': { from: 'confetti', region: { left: 0, top: 100, width: 1024, height: 1365 }, widths: DECK },
  'stats-deck-sparklers': { from: 'sparklers', region: { left: 0, top: 171, width: 1024, height: 1365 }, widths: DECK },
  'stats-deck-champagne': { from: 'champagne', region: { left: 0, top: 60, width: 1024, height: 1365 }, widths: DECK },
  'stats-deck-embrace': { from: 'embrace', region: { left: 0, top: 120, width: 1024, height: 1365 }, widths: DECK },
  'stats-deck-dance': { from: 'dance-slow', region: { left: 330, top: 0, width: 768, height: 1024 }, widths: DECK },
})

// Masters that are only used as a crop source — no variants of their own.
const SOURCE_ONLY = new Set(['slideshow-hero', 'mock-moderation', 'mock-venue-aerial'])

const isVariant = (f) => /-\d+\.webp$/.test(f)

async function importMaster(src, name) {
  const out = join(SRC, `${name}.webp`)
  await sharp(src).rotate().webp({ quality: 88, effort: 6 }).toFile(out)
  console.log('master', out)
}

async function buildVariants(name, input, steps = WIDTHS) {
  const meta = await sharp(input).metadata()
  // Standard steps below the top width, then the top width itself: the
  // source's, capped at the last step (a wider master must not list it
  // twice).
  const top = Math.min(meta.width, steps.at(-1))
  const widths = steps.filter((w) => w < top - 40)
  widths.push(top)
  const out = []
  for (const w of widths) {
    const file = join(OUT, `${name}-${w}.webp`)
    const info = await sharp(input).resize({ width: w, withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 6, smartSubsample: true }).toFile(file)
    out.push({ w, bytes: info.size })
  }
  console.log(name.padEnd(22), out.map((o) => `${o.w}w ${Math.round(o.bytes / 1024)}K`).join('  '))
  return { width: meta.width, height: meta.height, widths }
}

const args = process.argv.slice(2)
if (args[0] === '--import') {
  if (!args[1] || !args[2]) throw new Error('usage: --import <source image> <name>')
  await importMaster(args[1], args[2])
  process.exit(0)
}

const manifest = {}
const masters = readdirSync(SRC).filter((f) => f.endsWith('.webp') && !isVariant(f)).sort()
for (const f of masters) {
  const name = f.replace(/\.webp$/, '')
  if (SOURCE_ONLY.has(name)) continue
  manifest[name] = await buildVariants(name, join(SRC, f), SMALL[name])
}
for (const [name, { from, region, widths }] of Object.entries(CROPS)) {
  const src = join(SRC, `${from}.webp`)
  if (!existsSync(src)) throw new Error(`crop ${name}: missing master ${from}`)
  // Lossless in between, so the crop is only compressed once.
  const buf = await sharp(src).extract(region).png().toBuffer()
  manifest[name] = await buildVariants(name, buf, widths)
}

// JSON (not .ts) so Nuxt's component scanner leaves it alone.
const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n')
console.log('manifest', MANIFEST)
