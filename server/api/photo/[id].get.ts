import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/photo/[id] — returns a short-lived signed URL for a single
 * photo, redirecting the client straight to Supabase Storage's CDN.
 *
 * No auth: anyone with a photo UUID gets the URL. UUIDs are
 * cryptographically random so guessing them is infeasible. Used by
 * the live slideshow which is shared via a (couple-controlled) link.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: photo, error } = await admin
    .from('photos')
    .select('storage_path, thumbnail_path, is_hidden')
    .eq('id', id!)
    .maybeSingle()
  if (error || !photo) fail(404, 'photo_not_found')
  if (photo!.is_hidden) fail(410, 'photo_hidden')

  // ?t=thumb returns the small 400x400 thumbnail (much faster). When
  // it doesn't exist (legacy photos pre-sharp or non-photo media),
  // we fall through to the original.
  const query = getQuery(event)
  const wantsThumb = query.t === 'thumb'
  const pathToServe =
    wantsThumb && photo!.thumbnail_path ? photo!.thumbnail_path : photo!.storage_path

  const { data: signed, error: signErr } = await admin.storage
    .from('photos')
    .createSignedUrl(pathToServe, 60 * 30) // 30 minutes
  if (signErr || !signed?.signedUrl) {
    console.error('[photo] sign failed', signErr)
    fail(500, 'sign_failed')
  }

  // 302 redirect to the signed CDN URL. Browser caches the image on
  // the final URL, not on /api/photo/[id], so repeat hits during a
  // slideshow session don't re-call the API.
  return sendRedirect(event, signed!.signedUrl, 302)
})
