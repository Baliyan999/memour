import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * GET /api/admin/events/[id] — one event for the admin edit form.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', ((user as any).id ?? (user as any).sub))
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, status, plan_tier, owner_id, owner_phone, table_count')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  return { event: ev }
})
