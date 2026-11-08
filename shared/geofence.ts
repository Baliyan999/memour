/**
 * Soft geofence — one source of truth for the admin form and the
 * server: the radius limits, the margin the upload endpoint adds, and
 * turning whatever the admin pastes (plain coordinates or a Google /
 * Yandex Maps link) into the venue point.
 *
 * What a guest gets (server/api/guest/upload.post.ts): with a venue
 * point set, the capture screen asks for the phone's location when the
 * guest shoots. A shot is refused (403 outside_geofence) only when the
 * guest is farther than radius + GEOFENCE_SLACK_M + twice the accuracy
 * the phone reports. No location (denied, timed out) → accepted.
 */

/** Bounds of events.geofence_radius the server accepts, in metres. */
export const GEOFENCE_RADIUS_MIN = 20
export const GEOFENCE_RADIUS_MAX = 2000
/** Radii the admin form offers, in metres. */
export const GEOFENCE_RADII = [100, 200, 300, 500] as const
export const GEOFENCE_DEFAULT_RADIUS = 200
/** Margin the upload endpoint always adds to the radius (indoor GPS is often hundreds of metres off). */
export const GEOFENCE_SLACK_M = 250

export interface LatLng { lat: number; lng: number }

export type VenueLocation =
  | { ok: true; point: LatLng }
  | { ok: false; reason: 'empty' | 'short_link' | 'not_found' }

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

function point(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // "0, 0" is what an empty map link carries, never a wedding hall.
  if (lat === 0 && lng === 0) return null
  return { lat: round6(lat), lng: round6(lng) }
}

const DEC = String.raw`[-+]?\d{1,3}(?:\.\d+)?`
const DEC_COMMA = String.raw`[-+]?\d{1,3},\d+`

/** Hemisphere letter → sign. */
function signed(value: number, letter: string | undefined): number {
  return letter && /[SW]/i.test(letter) ? -Math.abs(value) : value
}

/**
 * Coordinates as people type or copy them, latitude first (Google,
 * Yandex and Apple all show them that way):
 *   41.311081, 69.240562 · 41.311081 69.240562 · 41,311081; 69,240562
 *   41.311081° N, 69.240562° E · 41°18'39.9"N 69°14'26.0"E
 */
export function parseCoordinates(text: string): LatLng | null {
  const s = text.trim().replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"')
  const dot = new RegExp(String.raw`^(${DEC})\s*°?\s*([NS])?\s*[,;\s]\s*(${DEC})\s*°?\s*([EW])?$`, 'i').exec(s)
  if (dot) return point(signed(Number(dot[1]), dot[2]), signed(Number(dot[3]), dot[4]))
  // Decimal commas: the pair is then split by a semicolon or a space.
  const comma = new RegExp(String.raw`^(${DEC_COMMA})\s*°?\s*([NS])?\s*(?:;|,?\s)\s*(${DEC_COMMA})\s*°?\s*([EW])?$`, 'i').exec(s)
  if (comma) {
    return point(signed(Number(comma[1]!.replace(',', '.')), comma[2]), signed(Number(comma[3]!.replace(',', '.')), comma[4]))
  }
  // Degrees, minutes, seconds with N/S and E/W (what Google shows for a dropped pin).
  const part = String.raw`(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*'\s*(?:(\d{1,2}(?:\.\d+)?)\s*")?\s*`
  const dms = new RegExp(String.raw`^${part}([NS])\s*,?\s*${part}([EW])$`, 'i').exec(s)
  if (dms) {
    const deg = (d: string, m: string, sec: string | undefined) => Number(d) + Number(m) / 60 + Number(sec ?? 0) / 3600
    return point(signed(deg(dms[1]!, dms[2]!, dms[3]), dms[4]), signed(deg(dms[5]!, dms[6]!, dms[7]), dms[8]))
  }
  return null
}

/** The first "a,b" pair of decimals in a URL parameter (pt=69.24,41.31,pm2rdm · q=loc:41.31,69.24). */
function firstPair(v: string | null): [number, number] | null {
  const m = v ? /([-+]?\d{1,3}(?:\.\d+)?)\s*,\s*\+?([-+]?\d{1,3}(?:\.\d+)?)/.exec(v) : null
  return m ? [Number(m[1]), Number(m[2])] : null
}

// Share links that only redirect — the coordinates aren't in them.
const SHORT_LINK = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|go\.2gis\.com|ya\.cc)$/i

function toUrl(text: string): URL | null {
  const m = /(https?:\/\/\S+)/i.exec(text) ?? /((?:www\.|maps\.|yandex\.|google\.)\S+)/i.exec(text)
  if (!m) return null
  try {
    return new URL(/^https?:/i.test(m[1]!) ? m[1]! : `https://${m[1]}`)
  } catch {
    return null
  }
}

function fromUrl(url: URL): VenueLocation {
  const host = url.hostname.toLowerCase()
  const q = url.searchParams
  let path = url.pathname
  try { path = decodeURIComponent(path) } catch { /* keep it encoded */ }
  const ok = (p: LatLng | null): VenueLocation | null => (p ? { ok: true, point: p } : null)

  if (SHORT_LINK.test(host)) return { ok: false, reason: 'short_link' }

  if (/(^|\.)yandex\.[a-z.]+$/.test(host) || /(^|\.)ya\.ru$/.test(host)) {
    if (path.includes('/maps/-/')) return { ok: false, reason: 'short_link' }
    // Yandex puts LONGITUDE first in its URL parameters: the dropped
    // pin (whatshere[point], pt) beats the map centre (ll).
    for (const key of ['whatshere[point]', 'pt', 'll']) {
      const pair = firstPair(q.get(key))
      const found = pair && ok(point(pair[1], pair[0]))
      if (found) return found
    }
    // A search box query is what a person typed: latitude first.
    const text = q.get('text')
    return (text && ok(parseCoordinates(text))) || { ok: false, reason: 'not_found' }
  }

  // Google, Apple and everyone else: latitude first. The place's own pin
  // (!3d…!4d… in /place/ links) beats a query, which beats the view (@).
  const pin = /!3d([-+]?\d{1,3}(?:\.\d+)?)!4d([-+]?\d{1,3}(?:\.\d+)?)/.exec(url.href)
  const fromPin = pin && ok(point(Number(pin[1]), Number(pin[2])))
  if (fromPin) return fromPin
  for (const key of ['q', 'query', 'destination', 'daddr', 'll', 'sll', 'center']) {
    const pair = firstPair(q.get(key))
    const found = pair && ok(point(pair[0], pair[1]))
    if (found) return found
  }
  const inPath = /\/(?:place|search|dir)\/(?:[^/]*\/)?([-+]?\d{1,3}\.\d+)\s*,\s*\+?([-+]?\d{1,3}\.\d+)/.exec(path)
  const fromPath = inPath && ok(point(Number(inPath[1]), Number(inPath[2])))
  if (fromPath) return fromPath
  const at = /@([-+]?\d{1,3}\.\d+),([-+]?\d{1,3}\.\d+)/.exec(path)
  return (at && ok(point(Number(at[1]), Number(at[2])))) || { ok: false, reason: 'not_found' }
}

/** Whatever the admin pasted → the venue point, or why there is none. */
export function parseVenueLocation(raw: string): VenueLocation {
  const text = raw.trim()
  if (!text) return { ok: false, reason: 'empty' }
  const geoUri = /^geo:([^?;]+)/i.exec(text)
  if (geoUri) {
    const pair = firstPair(geoUri[1]!)
    const p = pair && point(pair[0], pair[1])
    return p ? { ok: true, point: p } : { ok: false, reason: 'not_found' }
  }
  const url = toUrl(text)
  if (url) return fromUrl(url)
  const plain = parseCoordinates(text)
  if (plain) return { ok: true, point: plain }
  // Coordinates inside other text ("Navro'z, 41.311081, 69.240562").
  const loose = /([-+]?\d{1,2}\.\d{3,})\s*,\s*([-+]?\d{1,3}\.\d{3,})/.exec(text)
  const p = loose && point(Number(loose[1]), Number(loose[2]))
  return p ? { ok: true, point: p } : { ok: false, reason: 'not_found' }
}

export const formatLatLng = (p: LatLng) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`

/** Opens the point in Google Maps (web or app) — for checking it by eye. */
export const mapCheckUrl = (p: LatLng) =>
  `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`
