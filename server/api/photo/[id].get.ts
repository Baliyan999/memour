import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { userId } from '../../utils/auth'
import { fail } from '../../utils/errors'

/**
 * GET /api/photo/[id] — returns a short-lived signed URL for a single
 * item (photo, video or voice clip), redirecting the client straight
 * to Supabase Storage's CDN.
 *
 * Public: anyone with an item UUID gets the URL while the event is
 * active and the item isn't hidden. UUIDs are cryptographically random
 * so guessing them is infeasible. Used by the live slideshow which is
 * shared via a (couple-controlled) link — so only for tiers that have
 * the slideshow (Pro and up); on Basic the answer is 403 not_in_plan.
 *
 * Owner: the couple also gets hidden items and items of non-active
 * events — the dashboard's Hidden filter and moderation show them so
 * the couple can decide what to restore.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: photo, error } = await admin
    .from('photos')
    .select('event_id, storage_path, thumbnail_path, is_hidden, media_type, events!inner(owner_id, status, plan_tier)')
    .eq('id', id!)
    .maybeSingle()
  if (error || !photo) fail(404, 'photo_not_found')

  const ev = photo!.events
  const liveInPlan = tierHas(ev.plan_tier, 'live_slideshow')
  if (photo!.is_hidden || ev.status !== 'active' || !liveInPlan) {
    // Only pay for the session lookup when the public answer is "no".
    const uid = await userId(event)
    if (!uid || uid !== ev.owner_id) {
      if (photo!.is_hidden) fail(410, 'photo_hidden')
      if (ev.status === 'archived') fail(410, 'event_archived')
      if (ev.status !== 'active') fail(403, 'event_not_active')
      fail(403, 'not_in_plan')
    }
  }

  // ?t=thumb returns the small 400x400 thumbnail (much faster). When
  // it doesn't exist for a photo (legacy, pre-sharp) we fall through to
  // the original. Video and voice clips have no thumbnail: answering
  // with the clip itself would make an <img> pull up to 30 MB and then
  // fail anyway, so say so instead.
  const query = getQuery(event)
  const wantsThumb = query.t === 'thumb'
  let pathToServe = photo!.storage_path
  if (wantsThumb) {
    if (photo!.thumbnail_path) pathToServe = photo!.thumbnail_path
    else if (photo!.media_type !== 'photo') fail(404, 'no_thumbnail')
  }
  // Only the server writes photo rows, but never sign an object outside
  // the photo's own event folder.
  if (!pathToServe.startsWith(`${photo!.event_id}/`)) fail(404, 'photo_not_found')

  const { data: signed, error: signErr } = await admin.storage
    .from('photos')
    .createSignedUrl(pathToServe, 60 * 30) // 30 minutes
  if (signErr || !signed?.signedUrl) {
    console.error('[photo] sign failed', signErr)
    fail(500, 'sign_failed')
  }

  // 302 redirect to the signed CDN URL. Without cache headers every
  // hit minted a fresh token, so the browser could never reuse bytes it
  // already had — the slideshow re-downloaded each photo and clip on
  // every rotation. Caching the redirect for part of the signature's
  // lifetime keeps the final URL (and its HTTP cache entry) stable.
  // `private` + Vary: Cookie because the owner gets answers the public
  // doesn't (hidden items).
  setResponseHeaders(event, {
    'Cache-Control': 'private, max-age=1200',
    Vary: 'Cookie',
  })
  return sendRedirect(event, signed!.signedUrl, 302)
})
