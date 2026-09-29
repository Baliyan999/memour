import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * GET /api/admin/qr-settings/[id] — read the stored QR settings for
 * an event. Admin only. Returns {} when nothing has been saved yet,
 * plus the public URL of the saved logo for the preview.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins').select('user_id').eq('user_id', uid).maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const { data } = await admin
    .from('events').select('qr_settings').eq('id', id!).maybeSingle()
  if (!data) fail(404, 'event_not_found')
  const settings = ((data as any).qr_settings ?? {}) as Record<string, any>
  const logo_url = typeof settings.logo_path === 'string' && settings.logo_path
    ? admin.storage.from('branding').getPublicUrl(settings.logo_path).data.publicUrl
    : null
  return { settings, logo_url }
})
