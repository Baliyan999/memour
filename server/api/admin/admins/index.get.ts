import type { Database } from '~/types/database.types'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

/**
 * GET /api/admin/admins — list the admin team with role + email.
 *
 * Anyone in `admins` can read the list (so a regular admin sees who
 * else is in the team). Only super-admins can mutate via the sibling
 * POST / DELETE endpoints.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: me } = await admin
    .from('admins')
    .select('user_id, role')
    .eq('user_id', uid)
    .maybeSingle()
  if (!me)
    fail(403, 'forbidden')

  // Fetch all admin rows
  const { data: rows } = await admin
    .from('admins')
    .select('user_id, role, added_at')
    .order('added_at', { ascending: true })

  // Resolve emails via auth.admin.listUsers (paginated cap should be
  // enough for a small ops team).
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
  const emailMap = new Map<string, string>()
  for (const u of list?.users ?? []) {
    if (u.email)
      emailMap.set(u.id, u.email)
  }

  return {
    admins: (rows ?? []).map(r => ({
      user_id: r.user_id,
      role: (r as any).role ?? 'admin',
      added_at: r.added_at,
      email: emailMap.get(r.user_id) ?? null,
    })),
    me: { user_id: uid, role: (me as any).role ?? 'admin' },
  }
})
