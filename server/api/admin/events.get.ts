import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/admin/events — lists every event in the system. Service-role
 * client bypasses RLS so admins see all events regardless of owner.
 * Caller must be an admin (checked against `admins` table).
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!adminRow) throw createError({ statusCode: 403, statusMessage: 'Not an admin' })

  const { data, error } = await admin
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, status, plan_tier, owner_id, created_at')
    .order('created_at', { ascending: false })

  if (error) throw createError({ statusCode: 500, statusMessage: error.message })
  return { events: data ?? [] }
})
