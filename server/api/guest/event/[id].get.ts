import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { deviceLimitsForTier, guestLimitForTier } from '../../../utils/guest-quota'
import { uploadWindow, uploadWindowState } from '../../../utils/upload-window'
import { fail } from '../../../utils/errors'
import { hasGuestConsent } from '../../../utils/consent'

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
 * Also returns the per-device limits for the event's tier and the
 * upload window (plus the server clock) so the page can say "opens
 * at 18:00" / "closed" up front instead of after the guest has shot,
 * and — with a device_id — whether that device has accepted the
 * current guest texts (`consented`; the welcome screen asks otherwise).
 *
 * `guests_full`: a device that isn't bound yet would be refused — the
 * event already has as many guests as its tier takes. The page says so
 * up front instead of after the name and the boxes; the binding
 * endpoint is what actually enforces it. Also without a device_id (the
 * server-rendered first paint): the page then waits for its own device
 * check instead of showing a name form that may be taken away.
 *
 * Branding is the couple's design of this page (Pro and up). On Basic
 * it is left out, so the page shows the standard Memour design even if
 * a row was saved earlier.
 *
 * Returns 404 if the event doesn't exist, 410 if it is archived.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    fail(400, 'invalid_id')
  }

  const query = getQuery(event)
  const rawDeviceId = typeof query.device_id === 'string' ? query.device_id : ''
  // Accept only well-formed UUIDs — useDeviceId generates v4 UUIDs,
  // so anything else is malformed or hostile. Strictly 8-4-4-4-12: the
  // consent lookup compares it with a uuid column, where 36 dashes
  // would be a database error instead of "no binding".
  const deviceId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawDeviceId) ? rawDeviceId : null

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
      archive_expires_at,
      branding ( bride_name, groom_name, cover_photo, accent_color, greeting_text )
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[guest/event] read failed', error)
    fail(500, 'server_error')
  }
  if (!data) {
    fail(404, 'event_not_found')
  }
  if (data.status === 'archived') {
    fail(410, 'event_archived')
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
  const consented = deviceId ? await hasGuestConsent(event, id!, deviceId) : false

  let guestsFull = false
  if (!binding) {
    const { count } = await admin
      .from('guest_devices')
      .select('device_id', { count: 'exact', head: true })
      .eq('event_id', id)
    guestsFull = (count ?? 0) >= guestLimitForTier(data.plan_tier)
  }

  const now = Date.now()
  const window = uploadWindow(data.wedding_date)

  return {
    event: { ...data, branding: tierHas(data.plan_tier, 'branding') ? data.branding : null },
    binding,
    consented,
    guests_full: guestsFull,
    limits: deviceLimitsForTier(data.plan_tier),
    upload_window: {
      opens_at: window?.opensAt.toISOString() ?? null,
      closes_at: window?.closesAt.toISOString() ?? null,
      state: uploadWindowState(data.wedding_date, now),
      server_now: new Date(now).toISOString(),
    },
  }
})
