import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

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
 * Returns 404 if the event doesn't exist or is in `draft` status —
 * draft events aren't supposed to receive guest uploads.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid event id', data: { code: 'invalid_id' } })
  }

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

  return { event: data }
})
