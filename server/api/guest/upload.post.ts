import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { notifyEventUpload } from '../../utils/telegram'
import { hitRateLimit, getTrustedClientIp } from '../../utils/rate-limit'
import { deviceLimitsForTier, counterColumn, claimGuestDevice, type GuestMediaKind } from '../../utils/guest-quota'
import { readMultipartLimited } from '../../utils/multipart'
import { sniffContainer, type MediaContainer } from '../../utils/media-sniff'
import { uploadWindowState } from '../../utils/upload-window'
import { fail } from '../../utils/errors'
import { hasGuestConsent } from '../../utils/consent'

/**
 * POST /api/guest/upload — accepts a single photo / video / voice blob
 * from an anonymous guest, validates window/geofence/quota, writes to
 * Storage, and inserts a row in `photos`.
 *
 * Request is multipart/form-data (Content-Length required):
 *   - event_id      UUID
 *   - device_id     UUID (localStorage, see useDeviceId)
 *   - upload_id     optional UUID, one per captured blob — makes
 *                   retries idempotent (becomes photos.id)
 *   - media_type    photo | video | voice
 *   - file          binary
 *   - guest_name    optional string (≤80 chars)
 *   - guest_table   int from the QR's ?t=
 *   - guest_lat / guest_lng / guest_accuracy   optional (geofence)
 *
 * Validation:
 *   - Body ≤ MAX_BODY_BYTES, checked from Content-Length before reading
 *   - File bytes must be a container we expect for the media type
 *     (magic bytes, not the client's Content-Type)
 *   - Event must exist, be `active`, and be inside its upload window
 *     (see server/utils/upload-window.ts)
 *   - Soft geofence: only a guest who is clearly far away, even after
 *     allowing for their reported GPS accuracy, is refused
 *   - Per-device quota for the event's plan tier, reserved atomically
 *     before the file is stored
 *   - A device new to the event takes one of its guest places first
 *     (409 guest_limit_reached when the tier's guests are all in)
 *   - The device has accepted the current guest rules, licence notice
 *     and privacy policy for this event (consent_events, written by the
 *     welcome screen via /api/guest/binding) — else 403 consent_required
 *
 * Files are stored at `photos://{event_id}/{photos|video|voice}/{id}.{ext}`.
 */

// Per-media limits. Voice clips are smallest, then photos, then video.
// `containers` maps what we accept (by magic bytes) to the stored
// mime + extension; `mimes` is the allow-list for the declared type.
const LIMITS: Record<GuestMediaKind, {
  maxBytes: number
  mimes: Set<string>
  containers: Partial<Record<MediaContainer, { mime: string; ext: string }>>
}> = {
  photo: {
    maxBytes: 6 * 1024 * 1024,
    mimes: new Set(['image/jpeg', 'image/png', 'image/webp']),
    // Always re-encoded to JPEG below.
    containers: {
      jpeg: { mime: 'image/jpeg', ext: 'jpg' },
      png: { mime: 'image/jpeg', ext: 'jpg' },
      webp: { mime: 'image/jpeg', ext: 'jpg' },
    },
  },
  video: {
    maxBytes: 30 * 1024 * 1024,
    mimes: new Set(['video/webm', 'video/mp4']),
    containers: {
      webm: { mime: 'video/webm', ext: 'webm' },
      mp4: { mime: 'video/mp4', ext: 'mp4' },
    },
  },
  voice: {
    maxBytes: 5 * 1024 * 1024,
    mimes: new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg']),
    containers: {
      webm: { mime: 'audio/webm', ext: 'webm' },
      mp4: { mime: 'audio/mp4', ext: 'm4a' },
      mp3: { mime: 'audio/mpeg', ext: 'mp3' },
      ogg: { mime: 'audio/ogg', ext: 'ogg' },
    },
  },
}

// Clip length is reported by the client; store at most what the
// recorder allows (15 s video, 60 s voice) plus a little slack.
const MAX_DURATION_MS: Record<GuestMediaKind, number> = { photo: 0, video: 16_000, voice: 61_000 }

// Largest file plus room for the text fields and multipart framing.
// nginx's client_max_body_size for this route must be at least this.
const MAX_BODY_BYTES = LIMITS.video.maxBytes + 256 * 1024

// Photos: refuse anything bigger than ~40 MP before it is decoded
// (a 16000×16000 PNG is 776 KB on the wire and ~1 GB decoded), and
// store originals at most 4096 px on the long edge.
const MAX_INPUT_PIXELS = 40_000_000
const MAX_ORIGINAL_EDGE = 4096

// Rate limits. The real brake is the per-device quota; these only
// stop floods. Per device is the primary key. Per IP is deliberately
// high: a whole venue on one Wi-Fi (or one carrier NAT) shares an IP
// and sends in bursts — first dance, cake.
const RATE_PER_DEVICE = { limit: 20, windowMs: 60_000 }
const RATE_PER_IP = { limit: 600, windowMs: 60_000 }

// Geofence slack. Indoor phone fixes are often off by hundreds of
// metres; the check is advisory (the location comes from the client),
// so it must never stop a guest who is actually in the hall.
const GEOFENCE_SLACK_M = 250
const GEOFENCE_MAX_ACCURACY_M = 1500

/**
 * Strip the codec suffix from a MIME string so we can compare it against
 * a simple allow-list. Browsers attach things like
 * `;codecs=vp9,opus` (Chrome desktop webm) or
 * `;codecs=avc1.42E01E,mp4a.40.2` (iOS Safari mp4) to the type
 * reported by MediaRecorder; if we don't strip them the upload was
 * rejected with `unsupported_mime` for every video and voice clip.
 */
function baseMime(t: string | undefined | null): string {
  return (t ?? '').split(';')[0]!.trim().toLowerCase()
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

// sharp work runs on libuv's small thread pool and a decoded 40 MP
// frame is ~160 MB. Two at a time keeps a burst of uploads from
// stacking decodes in memory; the rest wait their turn here.
const SHARP_SLOTS = 2
let sharpActive = 0
const sharpQueue: Array<() => void> = []
async function withSharpSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (sharpActive >= SHARP_SLOTS) {
    await new Promise<void>((resolve) => sharpQueue.push(resolve))
  }
  sharpActive++
  try {
    return await fn()
  } finally {
    sharpActive--
    sharpQueue.shift()?.()
  }
}

type Admin = ReturnType<typeof serverSupabaseServiceRole<Database>>
type Counts = { photo_count: number; video_count: number; voice_count: number }
const COUNTS = 'photo_count, video_count, voice_count'
const CAS_ATTEMPTS = 6

/**
 * Take one quota slot for this device, atomically.
 *
 * The old code read the counters, stored the file, then upserted
 * `count + 1` computed in JS — parallel uploads all passed the check
 * and overwrote each other's increments (and a photo upload could
 * wipe a concurrent voice increment). Now each slot is a single
 * conditional UPDATE (`… where photo_count = <what we read>`), so two
 * requests can't both take the last slot; the loser re-reads.
 */
async function reserveSlot(
  event: H3Event,
  admin: Admin,
  args: { eventId: string; deviceId: string; table: number; guestName: string | null; kind: GuestMediaKind; limit: number; tier: string | null },
): Promise<Counts> {
  const col = counterColumn(args.kind)
  const nowIso = new Date().toISOString()
  const nameField = args.guestName ? { guest_name: args.guestName } : {}

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const { data: row, error: readErr } = await admin
      .from('guest_devices')
      .select(`table_number, ${COUNTS}`)
      .eq('event_id', args.eventId)
      .eq('device_id', args.deviceId)
      .maybeSingle()
    if (readErr) {
      console.error('[guest/upload] binding read failed', readErr)
      fail(500, 'storage_error')
    }

    if (!row) {
      // First upload from this device (the welcome screen usually
      // created the row already). It takes a guest place — or gets 409
      // guest_limit_reached — then the slot is taken like any other.
      await claimGuestDevice(event, {
        eventId: args.eventId,
        deviceId: args.deviceId,
        table: args.table,
        guestName: args.guestName,
        tier: args.tier,
      })
      continue
    }

    const r = row!
    let query = admin
      .from('guest_devices')
      .update({ [col]: r[col] + 1, last_seen_at: nowIso, ...nameField } as any)
      .eq('event_id', args.eventId)
      .eq('device_id', args.deviceId)
      .eq(col, r[col])

    if (r.table_number !== args.table) {
      // The device is locked to the table it first sent from. A device
      // that hasn't sent anything yet just mis-scanned on the welcome
      // screen — let it move to the table it is at now.
      if (r.photo_count + r.video_count + r.voice_count > 0) fail(409, 'wrong_table')
      query = admin
        .from('guest_devices')
        .update({ table_number: args.table, [col]: 1, last_seen_at: nowIso, ...nameField } as any)
        .eq('event_id', args.eventId)
        .eq('device_id', args.deviceId)
        .eq('table_number', r.table_number)
        .eq('photo_count', 0)
        .eq('video_count', 0)
        .eq('voice_count', 0)
    } else if (r[col] >= args.limit) {
      fail(429, 'quota_exceeded')
    }

    const { data: bumped, error: updateErr } = await query.select(COUNTS)
    if (updateErr) {
      console.error('[guest/upload] binding update failed', updateErr)
      fail(500, 'storage_error')
    }
    if (bumped && bumped.length) return bumped[0]!
    // Lost the race to a parallel upload from the same device; re-read.
  }
  fail(503, 'server_busy')
}

/** Give a reserved slot back after the upload failed. Best effort. */
async function releaseSlot(admin: Admin, args: { eventId: string; deviceId: string; kind: GuestMediaKind }) {
  const col = counterColumn(args.kind)
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    const { data: row } = await admin
      .from('guest_devices')
      .select(COUNTS)
      .eq('event_id', args.eventId)
      .eq('device_id', args.deviceId)
      .maybeSingle()
    if (!row || row[col] <= 0) return
    const { data: done } = await admin
      .from('guest_devices')
      .update({ [col]: row[col] - 1 } as any)
      .eq('event_id', args.eventId)
      .eq('device_id', args.deviceId)
      .eq(col, row[col])
      .select(COUNTS)
    if (done && done.length) return
  }
  console.error('[guest/upload] could not release quota slot', args)
}

async function currentCounts(admin: Admin, eventId: string, deviceId: string): Promise<Counts> {
  const { data } = await admin
    .from('guest_devices')
    .select(COUNTS)
    .eq('event_id', eventId)
    .eq('device_id', deviceId)
    .maybeSingle()
  return data ?? { photo_count: 0, video_count: 0, voice_count: 0 }
}

function isDuplicateStorageError(err: unknown): boolean {
  const e = err as { statusCode?: string | number; error?: string; message?: string } | null
  return String(e?.statusCode) === '409' || e?.error === 'Duplicate' || /already exists/i.test(e?.message ?? '')
}

export default defineEventHandler(async (event) => {
  // Coarse per-IP ceiling BEFORE reading the body, so a flood costs us
  // a header parse, not a 30 MB buffer.
  const ip = getTrustedClientIp(event)
  const ipHit = hitRateLimit('upload-ip', ip, RATE_PER_IP.limit, RATE_PER_IP.windowMs)
  if (!ipHit.ok) {
    setResponseHeader(event, 'Retry-After', ipHit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const form = await readMultipartLimited(event, { maxBytes: MAX_BODY_BYTES, maxParts: 16, maxFieldBytes: 1024 })

  const fields = new Map<string, string>()
  let file: { filename?: string; type?: string; data: Buffer } | null = null
  for (const part of form) {
    if (part.name === 'file') {
      if (file) fail(422, 'invalid_input') // exactly one file per request
      file = { filename: part.filename, type: part.type, data: part.data }
    } else {
      fields.set(part.name, part.data.toString('utf8'))
    }
  }

  const schema = z.object({
    event_id: z.string().uuid(),
    // device_id is generated client-side once (useDeviceId) and
    // persisted in localStorage. Required — it powers the per-device
    // table binding, quota and rate limit.
    device_id: z.string().uuid(),
    upload_id: z.string().uuid().optional(),
    media_type: z.enum(['photo', 'video', 'voice']).default('photo'),
    duration_ms: z.coerce.number().int().min(0).max(120_000).optional(),
    guest_name: z.string().trim().max(80).optional(),
    // guest_table is no longer "optional input from the form" — it
    // arrives from the `?t=` query of the QR code. Required.
    guest_table: z.coerce.number().int().min(1).max(500),
    guest_lat: z.coerce.number().min(-90).max(90).optional(),
    guest_lng: z.coerce.number().min(-180).max(180).optional(),
    guest_accuracy: z.coerce.number().min(0).max(100_000).optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(fields))
  if (!parsed.success) fail(422, 'invalid_input')
  if (!file || file.data.length === 0) fail(400, 'missing_file')

  const input = parsed.data
  const kind = input.media_type as GuestMediaKind
  const limits = LIMITS[kind]
  const mime = baseMime(file!.type)
  if (!limits.mimes.has(mime)) {
    console.warn(
      `[guest/upload] rejected ${kind} with mime=${file!.type ?? '<empty>'} (base=${mime || '<empty>'})`,
    )
    fail(415, 'unsupported_mime')
  }
  if (file!.data.length > limits.maxBytes) fail(413, 'file_too_large')

  // The declared type is only a hint; the bytes decide.
  const container = sniffContainer(file!.data)
  const stored = container ? limits.containers[container] : undefined
  if (!stored) {
    console.warn(`[guest/upload] rejected ${kind}: declared ${mime}, bytes look like ${container ?? 'unknown'}`)
    fail(415, 'unsupported_mime')
  }

  // Per-device limit on top of the per-IP ceiling above.
  const deviceHit = hitRateLimit('upload-device', `${input.event_id}:${input.device_id}`, RATE_PER_DEVICE.limit, RATE_PER_DEVICE.windowMs)
  if (!deviceHit.ok) {
    setResponseHeader(event, 'Retry-After', deviceHit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, status, wedding_date, venue_lat, venue_lng, geofence_radius, plan_tier, table_count')
    .eq('id', input.event_id)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.status !== 'active') fail(403, 'event_not_active')

  const windowState = uploadWindowState(ev!.wedding_date)
  if (windowState === 'before') fail(403, 'window_not_open')
  if (windowState === 'after') fail(403, 'window_closed')

  if (ev!.table_count && input.guest_table > ev!.table_count) fail(422, 'invalid_table')

  // Soft geofence. Enforced only if the event has venue coords and
  // the guest shared a location — and then only when the guest is far
  // outside the radius even after their own reported accuracy.
  if (ev!.venue_lat != null && ev!.venue_lng != null && input.guest_lat != null && input.guest_lng != null) {
    const dist = haversine(ev!.venue_lat, ev!.venue_lng, input.guest_lat, input.guest_lng)
    const accuracy = Math.min(input.guest_accuracy ?? 0, GEOFENCE_MAX_ACCURACY_M)
    const allowed = (ev!.geofence_radius ?? 120) + GEOFENCE_SLACK_M + 2 * accuracy
    if (dist > allowed) fail(403, 'outside_geofence')
  }

  const tierLimits = deviceLimitsForTier(ev!.plan_tier)
  const limit = tierLimits[kind]
  if (limit <= 0) fail(403, 'not_in_plan')

  if (!(await hasGuestConsent(event, ev!.id, input.device_id))) fail(403, 'consent_required')

  // --- Idempotency ---
  // The client sends one upload_id per captured blob and reuses it on
  // every retry. If the row already exists, a previous attempt landed
  // and only its response got lost on the venue Wi-Fi: answer success
  // again without storing a second copy or charging the quota twice.
  const uploadId = input.upload_id ?? randomUUID()
  const duplicateResponse = async (existing: { id: string; uploaded_at: string }) => ({
    ok: true,
    duplicate: true,
    photo_id: existing.id,
    uploaded_at: existing.uploaded_at,
    counts: await currentCounts(admin, ev!.id, input.device_id),
    limits: tierLimits,
  })
  const findExisting = async () => {
    const { data } = await admin
      .from('photos')
      .select('id, event_id, uploaded_at')
      .eq('id', uploadId)
      .maybeSingle()
    return data
  }
  if (input.upload_id) {
    const existing = await findExisting()
    if (existing) {
      if (existing.event_id !== ev!.id) fail(409, 'duplicate_upload')
      return duplicateResponse(existing)
    }
  }

  // --- Device binding + per-device quota ---
  // Reserve the slot BEFORE storing anything; give it back if the
  // upload fails below.
  const slotArgs = { eventId: ev!.id, deviceId: input.device_id, kind }
  const counts = await reserveSlot(event, admin, {
    ...slotArgs,
    table: input.guest_table,
    guestName: input.guest_name || null,
    limit,
    tier: ev!.plan_tier,
  })

  const folder = kind === 'voice' ? 'voice' : kind === 'video' ? 'video' : 'photos'
  const storagePath = `${ev!.id}/${folder}/${uploadId}.${stored!.ext}`

  // For photos: strip EXIF (privacy — guests may not realize their
  // phone embeds GPS into JPGs), cap the size and re-encode. A file
  // sharp can't decode is refused, never stored as-is. For
  // video/voice, pass through untouched (container already checked).
  let storedBuffer: Buffer = file!.data
  let thumb: Buffer | null = null
  if (kind === 'photo') {
    try {
      const out = await withSharpSlot(async () => {
        const pipeline = sharp(file!.data, { failOn: 'truncated', limitInputPixels: MAX_INPUT_PIXELS }).rotate()
        const original = await pipeline
          .clone()
          .resize(MAX_ORIGINAL_EDGE, MAX_ORIGINAL_EDGE, { fit: 'inside', withoutEnlargement: true })
          // Plain libjpeg-turbo: mozjpeg cost ~7× the CPU on a 2200 px
          // frame, which queued every guest behind a burst of uploads.
          .jpeg({ quality: 85 })
          .toBuffer()
        // 400x400 cover-fit thumbnail
        const small = await pipeline
          .clone()
          .resize(400, 400, { fit: 'cover', position: 'attention' })
          .jpeg({ quality: 75, mozjpeg: true })
          .toBuffer()
        return { original, small }
      })
      storedBuffer = out.original
      thumb = out.small
    } catch (e) {
      console.warn('[guest/upload] sharp could not process photo', (e as Error)?.message)
      await releaseSlot(admin, slotArgs)
      fail(422, 'invalid_image')
    }
  }

  const { error: uploadErr } = await admin.storage
    .from('photos')
    .upload(storagePath, storedBuffer, {
      contentType: stored!.mime,
      upsert: false,
    })
  if (uploadErr) {
    await releaseSlot(admin, slotArgs)
    if (input.upload_id && isDuplicateStorageError(uploadErr)) {
      // A parallel retry of this same blob is storing it right now.
      const existing = await findExisting()
      return duplicateResponse(existing ?? { id: uploadId, uploaded_at: new Date().toISOString() })
    }
    console.error('[guest/upload] storage error', uploadErr)
    fail(500, 'storage_error')
  }

  let thumbnailPath: string | null = null
  if (thumb) {
    thumbnailPath = `${ev!.id}/thumbs/${uploadId}.jpg`
    const { error: thumbErr } = await admin.storage
      .from('photos')
      .upload(thumbnailPath, thumb, { contentType: 'image/jpeg', upsert: false })
    if (thumbErr) {
      console.error('[guest/upload] thumbnail upload failed', thumbErr)
      thumbnailPath = null // keep going; original is stored
    }
  }

  const { data: photo, error: insertErr } = await admin
    .from('photos')
    .insert({
      id: uploadId,
      event_id: ev!.id,
      storage_path: storagePath,
      guest_name: input.guest_name || null,
      guest_table: input.guest_table,
      mime_type: stored!.mime,
      size_bytes: storedBuffer.length,
      media_type: kind,
      duration_ms: kind === 'photo' || input.duration_ms == null
        ? null
        : Math.min(input.duration_ms, MAX_DURATION_MS[kind]),
      thumbnail_path: thumbnailPath,
    } as any)
    .select('id, uploaded_at')
    .single()
  if (insertErr || !photo) {
    await releaseSlot(admin, slotArgs)
    if (insertErr?.code === '23505') {
      const existing = await findExisting()
      if (existing) return duplicateResponse(existing)
    }
    console.error('[guest/upload] insert error', insertErr)
    const orphans = thumbnailPath ? [storagePath, thumbnailPath] : [storagePath]
    await admin.storage.from('photos').remove(orphans).catch(() => {})
    fail(500, 'storage_error')
  }

  // Fire-and-forget debounced Telegram notification to the founder
  // (event id and admin link only — no names). We don't await so the
  // guest gets their upload confirmation fast.
  void notifyEventUpload(ev!.id)

  return {
    ok: true,
    photo_id: photo!.id,
    uploaded_at: photo!.uploaded_at,
    counts,
    limits: tierLimits,
  }
})
