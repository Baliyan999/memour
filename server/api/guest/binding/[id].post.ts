import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hitRateLimit, getTrustedClientIp } from '../../../utils/rate-limit'
import { fail } from '../../../utils/errors'
import { consentField, hasGuestConsent, recordConsent, requireConsent } from '../../../utils/consent'

/**
 * POST /api/guest/binding/[id]
 *
 * Writes (or refreshes) a `guest_devices` row for this (event,
 * device) pair the moment the guest finishes the welcome screen —
 * i.e. enters their name and taps "Open camera". Before this
 * endpoint existed, the binding was only created on the FIRST
 * upload. That meant a guest who entered their name, opened the
 * camera, then closed the tab without snapping anything had no
 * server-side trace; on their next visit the welcome card would
 * ask for the name all over again.
 *
 * Body (JSON):
 *   device_id    UUID  — generated client-side once (useDeviceId)
 *   guest_name   1–80  — what the guest typed
 *   guest_table  int   — strictly from the ?t= in the QR code
 *   consent      { terms, guest_licence, privacy: version } — the
 *                welcome screen's checkboxes; recorded in
 *                consent_events for this event + device. Can be left
 *                out only if the device already accepted the current
 *                versions (then the screen doesn't show them again).
 *   locale       uz | ru — the language the texts were shown in
 *
 * Returns the binding row with current counters so the client can
 * render the dock chips immediately without an extra round-trip.
 *
 * Errors:
 *   404 event_not_found   id doesn't match a row
 *   403 event_not_active  the event was archived/drafted again
 *   422 invalid_table     ?t= is past the event's table_count
 *   422 consent_required  no consent in the body and none on record
 *   409 consent_outdated  the page showed older texts — reload
 *   409 wrong_table       this device already SENT media from a
 *                         different table at this event
 *   429 rate_limited
 */
const schema = z.object({
  device_id: z.string().uuid(),
  guest_name: z.string().trim().min(1).max(80),
  guest_table: z.coerce.number().int().min(1).max(500),
  consent: consentField,
  locale: z.enum(['uz', 'ru']).optional(),
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  // Same idea as the upload limits: generous per IP (a whole venue
  // shares one), tight per device.
  const ipHit = hitRateLimit('binding-ip', getTrustedClientIp(event), 300, 60_000)
  if (!ipHit.ok) {
    setResponseHeader(event, 'Retry-After', ipHit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const body = await readBody(event).catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const deviceHit = hitRateLimit('binding-device', `${id}:${parsed.data.device_id}`, 30, 60_000)
  if (!deviceHit.ok) {
    setResponseHeader(event, 'Retry-After', deviceHit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, status, table_count')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.status !== 'active') fail(403, 'event_not_active')
  if (ev!.table_count && parsed.data.guest_table > ev!.table_count) fail(422, 'invalid_table')

  // Guest rules, the licence for their files and the privacy policy —
  // accepted before the device is bound or anything is uploaded.
  const consented = await hasGuestConsent(event, id!, parsed.data.device_id)
  if (parsed.data.consent) {
    const docs = requireConsent('guest_upload', parsed.data.consent)
    if (!consented) {
      await recordConsent(event, {
        context: 'guest_upload',
        subject: { type: 'guest', eventId: id!, deviceId: parsed.data.device_id, guestName: parsed.data.guest_name },
        docs,
        locale: parsed.data.locale,
        extra: { table: parsed.data.guest_table },
      })
    }
  } else if (!consented) {
    fail(422, 'consent_required')
  }

  // Existing binding takes priority over the new (event, table)
  // pair from the URL — we never silently move a device that has
  // already sent media: its uploads are signed with that table. A
  // device that hasn't sent anything yet (it only typed a name at the
  // wrong table's QR) follows the table it is at now.
  const { data: existing } = await admin
    .from('guest_devices')
    .select('table_number, guest_name, photo_count, video_count, voice_count')
    .eq('event_id', id!)
    .eq('device_id', parsed.data.device_id)
    .maybeSingle()

  if (existing) {
    const tableChanged = existing.table_number !== parsed.data.guest_table
    if (tableChanged && existing.photo_count + existing.video_count + existing.voice_count > 0) {
      fail(409, 'wrong_table')
    }
    // Touch last_seen and accept the (possibly edited) name.
    // Counters are server-of-truth, leave them alone; the table only
    // moves while all of them are still 0.
    let update = admin
      .from('guest_devices')
      .update({
        guest_name: parsed.data.guest_name,
        last_seen_at: new Date().toISOString(),
        ...(tableChanged ? { table_number: parsed.data.guest_table } : {}),
      } as any)
      .eq('event_id', id!)
      .eq('device_id', parsed.data.device_id)
    if (tableChanged) {
      update = update.eq('photo_count', 0).eq('video_count', 0).eq('voice_count', 0)
    }
    const { data: updated } = await update.select('table_number, guest_name, photo_count, video_count, voice_count')
    // A first upload slipped in between the read and the move.
    if (tableChanged && !updated?.length) fail(409, 'wrong_table')

    return {
      ok: true,
      binding: updated?.[0] ?? { ...existing, guest_name: parsed.data.guest_name },
    }
  }

  // First time we see this device for this event — insert a fresh
  // row with zeroed counters.
  const { data: row, error: insertErr } = await admin
    .from('guest_devices')
    .insert({
      device_id: parsed.data.device_id,
      event_id: id!,
      table_number: parsed.data.guest_table,
      guest_name: parsed.data.guest_name,
    })
    .select('table_number, guest_name, photo_count, video_count, voice_count')
    .single()
  if (insertErr?.code === '23505') {
    // A double tap on "Open camera" raced us to the insert.
    const { data: raced } = await admin
      .from('guest_devices')
      .select('table_number, guest_name, photo_count, video_count, voice_count')
      .eq('event_id', id!)
      .eq('device_id', parsed.data.device_id)
      .maybeSingle()
    if (raced && raced.table_number === parsed.data.guest_table) return { ok: true, binding: raced }
    fail(409, 'wrong_table')
  }
  if (insertErr || !row) {
    console.error('[guest/binding] insert failed', insertErr)
    fail(500, 'server_error')
  }

  return { ok: true, binding: row }
})
