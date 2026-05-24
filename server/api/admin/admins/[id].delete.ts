import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * DELETE /api/admin/admins/[id] — remove a teammate from the admin
 * table. Super-admin only. Self-protection: the caller can't remove
 * themselves (would lock them out of their own panel).
 *
 * Removes only the admins row — the auth.users record stays so the
 * person can still log in to /dashboard as a regular couple if they
 * want, they just lose admin privileges.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

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
  if ((me as any).role !== 'super') fail(403, 'not_super')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')
  if (id === uid) fail(409, 'cannot_remove_self')

  const { error } = await admin.from('admins').delete().eq('user_id', id!)
  if (error) fail(500, 'delete_failed')

  return { ok: true }
})
