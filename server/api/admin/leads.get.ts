import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/admin/leads — list incoming leads with optional status
 * filter. Admin-only. Most recent first.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', user!.id)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : null

  let q = admin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status && ['new', 'contacted', 'won', 'lost'].includes(status)) {
    q = q.eq('status', status)
  }
  const { data, error } = await q
  if (error) fail(500, 'list_failed')
  return { leads: data ?? [] }
})
