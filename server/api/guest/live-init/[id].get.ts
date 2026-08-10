import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/guest/live-init/[id] — initial bootstrap data for the live
 * slideshow: event name + the 24 most recent visible photos. After
 * this initial fetch the page subscribes to Realtime for new uploads.
 *
 * Anonymous — same risk profile as the /e/[id]/live page itself.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, status')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')

  const { data: photos } = await admin
    .from('photos')
    .select('id, uploaded_at, guest_name, guest_table')
    .eq('event_id', id!)
    .eq('is_hidden', false)
    .order('uploaded_at', { ascending: false })
    .limit(24)

  return {
    event: { couple_names: ev!.couple_names },
    photos: photos ?? [],
  }
})
