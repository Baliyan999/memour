import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyEventUpload } from '../../utils/telegram'
import { checkRateLimit } from '../../utils/rate-limit'

/**
 * POST /api/guest/upload — accepts a single photo blob from an
 * anonymous guest, validates window/geofence, writes to Storage, and
 * inserts a row in `photos`.
 *
 * Request is multipart/form-data:
 *   - event_id    UUID
 *   - file        binary (jpeg/png/webp)
 *   - guest_name  optional string (≤80 chars)
 *   - guest_table optional int
 *   - guest_lat   optional float (for geofence)
 *   - guest_lng   optional float
 *
 * Validation:
 *   - Event must exist + be `active`
 *   - Today's date must be wedding_date ± WINDOW_HOURS
 *   - If event has geofence coords AND guest sent their location,
 *     guest must be within event.geofence_radius metres
 *   - File ≤ 6 MB, MIME in [image/jpeg, image/png, image/webp]
 *
 * Files are stored at `photos://{event_id}/{photo_id}.{ext}`.
 */
const WINDOW_HOURS = 18 // upload window before+after wedding

// Per-media limits. Voice clips are smallest, then photos, then video.
const LIMITS: Record<'photo' | 'video' | 'voice', { maxBytes: number; mimes: Set<string>; ext: Record<string, string> }> = {
  photo: {
    maxBytes: 6 * 1024 * 1024,
    mimes: new Set(['image/jpeg', 'image/png', 'image/webp']),
    ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  video: {
    maxBytes: 30 * 1024 * 1024,
    mimes: new Set(['video/webm', 'video/mp4']),
    ext: { 'video/webm': 'webm', 'video/mp4': 'mp4' },
  },
  voice: {
    maxBytes: 5 * 1024 * 1024,
    mimes: new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']),
    ext: { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' },
  },
}

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

/** Great-circle distance in metres between two lat/lng pairs. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export default defineEventHandler(async (event) => {
  // Per-IP rate limit: 30 uploads / minute, scoped per event so a
  // spammer can't disable uploads across all events at once.
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'
  const form = await readMultipartFormData(event)
  if (!form) fail(400, 'missing_body')

  const fields = new Map<string, string>()
  let file: { filename?: string; type?: string; data: Buffer } | null = null
  for (const part of form) {
    if (part.name === 'file' && part.data) {
      file = { filename: part.filename, type: part.type, data: part.data }
    } else if (part.name && part.data) {
      fields.set(part.name, part.data.toString('utf8'))
    }
  }

  const schema = z.object({
    event_id: z.string().uuid(),
    media_type: z.enum(['photo', 'video', 'voice']).default('photo'),
    duration_ms: z.coerce.number().int().min(0).max(120_000).optional(),
    guest_name: z.string().max(80).optional(),
    guest_table: z.coerce.number().int().min(1).max(500).optional(),
    guest_lat: z.coerce.number().min(-90).max(90).optional(),
    guest_lng: z.coerce.number().min(-180).max(180).optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(fields))
  if (!parsed.success) fail(422, 'invalid_input')
  if (!file) fail(400, 'missing_file')

  const limits = LIMITS[parsed.data.media_type]
  if (!limits.mimes.has(file!.type ?? '')) fail(415, 'unsupported_mime')
  if (file!.data.length > limits.maxBytes) fail(413, 'file_too_large')

  const input = parsed.data

  // Rate limit BEFORE the heavy supabase + sharp work.
  if (!checkRateLimit('upload', `${input.event_id}:${ip}`, 30, 60_000)) {
    fail(429, 'rate_limited')
  }

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, status, wedding_date, venue_lat, venue_lng, geofence_radius')
    .eq('id', input.event_id)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.status !== 'active') fail(403, 'event_not_active')

  // Wedding-day window check. We allow `wedding_date ± WINDOW_HOURS`.
  // Stored as date (YYYY-MM-DD); treat as local midnight of UZ
  // (UTC+5) so the window covers the actual evening of the event.
  const wedding = new Date(`${ev!.wedding_date}T00:00:00+05:00`)
  const now = Date.now()
  const diffHours = Math.abs(now - wedding.getTime()) / 3_600_000
  if (diffHours > WINDOW_HOURS) fail(403, 'outside_window')

  // Geofence: only enforced if the event has venue coords. If guest
  // didn't share their location, we accept (we can't measure).
  if (ev!.venue_lat != null && ev!.venue_lng != null && input.guest_lat != null && input.guest_lng != null) {
    const dist = haversine(ev!.venue_lat, ev!.venue_lng, input.guest_lat, input.guest_lng)
    if (dist > (ev!.geofence_radius ?? 120)) fail(403, 'outside_geofence')
  }

  // Pick extension from MIME via the media-type's LIMITS table.
  const ext = limits.ext[file!.type as string] ?? 'bin'
  const photoId = randomUUID()
  const folder = parsed.data.media_type === 'voice' ? 'voice'
    : parsed.data.media_type === 'video' ? 'video'
    : 'photos'
  const storagePath = `${ev!.id}/${folder}/${photoId}.${ext}`

  // For photos: strip EXIF (privacy — guests may not realize their
  // phone embeds GPS into JPGs) and re-encode at a slightly lower
  // quality. For video/voice, pass through untouched.
  let storedBuffer = file!.data
  let storedMime = file!.type
  let thumbnailPath: string | null = null
  if (parsed.data.media_type === 'photo') {
    try {
      const pipeline = sharp(file!.data, { failOn: 'truncated' }).rotate()
      // Strip EXIF + re-encode original as JPEG (smaller, no metadata)
      storedBuffer = await pipeline
        .clone()
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
      storedMime = 'image/jpeg'
      // Generate a 400x400 cover-fit thumbnail
      const thumb = await pipeline
        .clone()
        .resize(400, 400, { fit: 'cover', position: 'attention' })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer()
      thumbnailPath = `${ev!.id}/thumbs/${photoId}.jpg`
      const { error: thumbErr } = await admin.storage
        .from('photos')
        .upload(thumbnailPath, thumb, { contentType: 'image/jpeg', upsert: false })
      if (thumbErr) {
        console.error('[guest/upload] thumbnail upload failed', thumbErr)
        thumbnailPath = null // keep going; original still uploads
      }
    } catch (e) {
      console.error('[guest/upload] sharp processing failed', e)
      // Fall back to storing the raw bytes if sharp chokes
    }
  }

  const { error: uploadErr } = await admin.storage
    .from('photos')
    .upload(storagePath, storedBuffer, {
      contentType: storedMime,
      upsert: false,
    })
  if (uploadErr) {
    console.error('[guest/upload] storage error', uploadErr)
    fail(500, 'storage_error')
  }

  const { data: photo, error: insertErr } = await admin
    .from('photos')
    .insert({
      id: photoId,
      event_id: ev!.id,
      storage_path: storagePath,
      guest_name: input.guest_name || null,
      guest_table: input.guest_table ?? null,
      mime_type: storedMime ?? null,
      size_bytes: storedBuffer.length,
      media_type: parsed.data.media_type,
      duration_ms: parsed.data.duration_ms ?? null,
      thumbnail_path: thumbnailPath,
    } as any)
    .select('id, uploaded_at')
    .single()
  if (insertErr) {
    console.error('[guest/upload] insert error', insertErr)
    fail(500, 'storage_error')
  }

  // Fire-and-forget debounced Telegram notification to the founder.
  // We don't await so the guest gets their upload confirmation fast;
  // notify will run on the next tick.
  void notifyEventUpload(ev!.id, ev!.couple_names)

  return { ok: true, photo_id: photo.id, uploaded_at: photo.uploaded_at }
})

