import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { H3Event } from 'h3'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * DELETE /api/admin/admins/[id] — remove a teammate from the admin
 * table. Super-admin only. Self-protection: the caller can't remove
 * themselves (would lock them out of their own panel), and the last
 * super-admin can never be removed (team management would then need
 * SQL).
 *
 * Removes only the admins row — the auth.users record stays so the
 * person can still log in to /dashboard as a regular couple if they
 * want, they just lose admin privileges.
 */

// Removals run one at a time: the checks below read the table before
// the delete, so two supers removing each other at the same moment both
// passed them (each still a super, two supers left) and the team ended
// up with none. Single-instance Nitro, like the rate limits.
let removals: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = removals.then(fn, fn)
  removals = run.catch(() => {})
  return run
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  return oneAtATime(() => remove(event, admin, uid))
})

async function remove(event: H3Event, admin: ReturnType<typeof serverSupabaseServiceRole<Database>>, uid: string) {
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

  const { data: target } = await admin
    .from('admins').select('user_id, role').eq('user_id', id!).maybeSingle()
  if (!target) fail(404, 'admin_not_found')
  if ((target as any).role === 'super') {
    const { count } = await admin
      .from('admins').select('user_id', { count: 'exact', head: true }).eq('role', 'super')
    if ((count ?? 0) <= 1) fail(409, 'last_super')
  }

  const { error } = await admin.from('admins').delete().eq('user_id', id!)
  if (error) fail(500, 'delete_failed')

  return { ok: true }
}
