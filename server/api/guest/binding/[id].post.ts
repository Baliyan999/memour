import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

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
 *   device_id    UUID  — generated client-side once via crypto.randomUUID
 *   guest_name   1–80  — what the guest typed
 *   guest_table  int   — strictly from the ?t= in the QR code
 *
 * Returns the binding row with current counters so the client can
 * render the dock chips immediately without an extra round-trip.
 *
 * Errors:
 *   404 event_not_found   id doesn't match a row
 *   403 event_not_active  the event was archived/drafted again
 *   409 wrong_table       this device is already locked to a
 *                         different table at this event
 */
const schema = z.object({
  device_id: z.string().uuid(),
  guest_name: z.string().trim().min(1).max(80),
  guest_table: z.coerce.number().int().min(1).max(500),
})

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, status')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.status !== 'active') fail(403, 'event_not_active')

  // Existing binding takes priority over the new (event, table)
  // pair from the URL — we never silently overwrite the table the
  // device was first registered to. If they re-scanned someone
  // else's QR we send them to the lock screen instead.
  const { data: existing } = await admin
    .from('guest_devices')
    .select('table_number, guest_name, photo_count, video_count, voice_count')
    .eq('event_id', id!)
    .eq('device_id', parsed.data.device_id)
    .maybeSingle()

  if (existing) {
    if (existing.table_number !== parsed.data.guest_table) {
      fail(409, 'wrong_table')
    }
    // Same table — touch last_seen and accept the (possibly edited)
    // name. Counters are server-of-truth, leave them alone.
    await admin
      .from('guest_devices')
      .update({
        guest_name: parsed.data.guest_name,
        last_seen_at: new Date().toISOString(),
      } as any)
      .eq('event_id', id!)
      .eq('device_id', parsed.data.device_id)

    return {
      ok: true,
      binding: { ...existing, guest_name: parsed.data.guest_name },
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
  if (insertErr || !row) {
    console.error('[guest/binding] insert failed', insertErr)
    fail(500, 'server_error')
  }

  return { ok: true, binding: row }
})
