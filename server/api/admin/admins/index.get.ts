import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * GET /api/admin/admins — list the admin team with role + email.
 *
 * Anyone in `admins` can read the list (so a regular admin sees who
 * else is in the team). Only super-admins can mutate via the sibling
 * POST / DELETE endpoints.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: me } = await admin
    .from('admins')
    .select('user_id, role')
    .eq('user_id', uid)
    .maybeSingle()
  if (!me) fail(403, 'forbidden')

  // Fetch all admin rows
  const { data: rows, error } = await admin
    .from('admins')
    .select('user_id, role, added_at')
    .order('added_at', { ascending: true })
  if (error) fail(500, 'list_failed')

  // Resolve each admin's email by id — the team is small, and the
  // first page of listUsers() stops covering it once couples sign up.
  const emails = await Promise.all((rows ?? []).map(async (r) => {
    const { data } = await admin.auth.admin.getUserById(r.user_id)
    return data?.user?.email ?? null
  }))

  return {
    admins: (rows ?? []).map((r, i) => ({
      user_id: r.user_id,
      role: (r as any).role ?? 'admin',
      added_at: r.added_at,
      email: emails[i],
    })),
    me: { user_id: uid, role: (me as any).role ?? 'admin' },
  }
})
