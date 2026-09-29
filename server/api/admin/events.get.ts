import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../utils/errors'

/**
 * GET /api/admin/events — lists every event in the system. Service-role
 * client bypasses RLS so admins see all events regardless of owner.
 * Caller must be an admin (checked against `admins` table).
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

  const { data, error } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, status, plan_tier, owner_id, created_at, table_count')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin/events] list', error)
    fail(500, 'list_failed')
  }
  return { events: data ?? [] }
})
