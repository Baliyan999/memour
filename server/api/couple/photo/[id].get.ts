import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * GET /api/couple/photo/[id] — owner-only redirect to a short-lived
 * signed URL of one photo / video / voice message.
 *
 * Unlike the public /api/photo/[id] (slideshow), this one also serves
 * hidden media, so the couple can open what they hid and decide to
 * bring it back. `?t=thumb` returns the 400px thumbnail when one exists.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: photo } = await admin
    .from('photos')
    .select('event_id, storage_path, thumbnail_path, events!inner(owner_id)')
    .eq('id', id!)
    .maybeSingle()
  if (!photo) fail(404, 'photo_not_found')
  if (photo!.events.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')

  const wantsThumb = getQuery(event).t === 'thumb'
  const path = wantsThumb && photo!.thumbnail_path ? photo!.thumbnail_path : photo!.storage_path
  // Only objects inside the event's own folder — the row's path must
  // not be a way to reach another event's files.
  if (!path.startsWith(`${photo!.event_id}/`)) fail(404, 'photo_not_found')

  const { data: signed, error } = await admin.storage
    .from('photos')
    .createSignedUrl(path, 60 * 30)
  if (error || !signed?.signedUrl) {
    console.error('[couple/photo] sign failed', error)
    fail(500, 'sign_failed')
  }

  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  return sendRedirect(event, signed!.signedUrl, 302)
})
