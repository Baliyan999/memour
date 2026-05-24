import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/admin/qr-settings/[id] — read the stored QR settings for
 * an event. Admin only. Returns {} when nothing has been saved yet.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401 })
  const uid = (user as any).id ?? (user as any).sub
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', uid).maybeSingle()
  if (!adminRow) throw createError({ statusCode: 403 })

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw createError({ statusCode: 400 })

  const { data } = await admin
    .from('events').select('qr_settings').eq('id', id!).maybeSingle()
  return { settings: (data as any)?.qr_settings ?? {} }
})
