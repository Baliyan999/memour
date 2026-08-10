import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { DEVICE_LIMITS } from '../../../utils/guest-quota'

/**
 * GET /api/guest/event/[id] — public read of an event (no auth).
 *
 * RLS keeps events private to their owner, so the guest page can't
 * read the table directly. This server endpoint uses the service-role
 * client to bypass RLS and returns a SANITIZED subset — only fields
 * needed to render the guest landing (names, status, geofence center,
 * wedding date) + branding. Sensitive fields (owner_id, etc.) never
 * leave the server.
 *
 * Optional `?device_id=<uuid>` query — when the guest's browser passes
 * its persisted device id, we look up the existing binding (table,
 * name, counters) for this event so the welcome screen can either
 *   - skip the name input and jump straight to camera (same table), or
 *   - show a polite "this device is already locked to table N" wall
 *     (different table — they re-scanned someone else's QR).
 *
 * Returns 404 if the event doesn't exist or is in `archived` status.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id', data: { code: 'invalid_id' } })
  }

  const query = getQuery(event)
  const rawDeviceId = typeof query.device_id === 'string' ? query.device_id : ''
  // Accept only well-formed UUIDs — we generate `crypto.randomUUID()`
  // client-side, so anything else is malformed or hostile.
  const deviceId = /^[0-9a-f-]{36}$/i.test(rawDeviceId) ? rawDeviceId : null

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data, error } = await admin
    .from('events')
    .select(`
      id,
      couple_names,
      wedding_date,
      venue_name,
      venue_lat,
      venue_lng,
      geofence_radius,
      status,
      plan_tier,
      table_count,
      branding ( bride_name, groom_name, cover_photo, accent_color, greeting_text )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[guest/event] read failed', error)
    throw createError({ statusCode: 500, statusMessage: 'server error', data: { code: 'server_error' } })
  }
  if (!data) {
    throw createError({ statusCode: 404, statusMessage: 'not found', data: { code: 'event_not_found' } })
  }
  if (data.status === 'archived') {
    throw createError({ statusCode: 410, statusMessage: 'event archived', data: { code: 'event_archived' } })
  }

  let binding: {
    table_number: number
    guest_name: string | null
    photo_count: number
    video_count: number
    voice_count: number
  } | null = null

  if (deviceId) {
    const { data: row } = await admin
      .from('guest_devices')
      .select('table_number, guest_name, photo_count, video_count, voice_count')
      .eq('event_id', id)
      .eq('device_id', deviceId)
      .maybeSingle()
    if (row) binding = row
  }

  return {
    event: data,
    binding,
    limits: DEVICE_LIMITS,
  }
})
