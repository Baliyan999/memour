import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * PATCH /api/couple/photo/[id] — toggle is_hidden / is_highlight on
 * a single photo. Used by the swipe-moderation UI.
 *
 * The caller must own the event the photo belongs to. RLS already
 * enforces this when the regular Supabase client queries, but we
 * also gate explicitly here so a malicious client can't bypass via
 * server endpoint with the user's JWT.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  is_hidden: z.boolean().optional(),
  is_highlight: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')
  if (parsed.data.is_hidden === undefined && parsed.data.is_highlight === undefined) {
    fail(422, 'nothing_to_update')
  }

  const admin = serverSupabaseServiceRole<Database>(event)

  // Ownership check via join.
  const { data: photo } = await admin
    .from('photos')
    .select('id, event_id, events!inner(owner_id)')
    .eq('id', id!)
    .maybeSingle()
  if (!photo) fail(404, 'photo_not_found')
  // @ts-expect-error nested relation typing
  if (photo.events.owner_id !== user!.id) fail(403, 'forbidden')

  const updates: Record<string, boolean> = {}
  if (parsed.data.is_hidden !== undefined) updates.is_hidden = parsed.data.is_hidden
  if (parsed.data.is_highlight !== undefined) updates.is_highlight = parsed.data.is_highlight

  const { error } = await admin
    .from('photos')
    .update(updates)
    .eq('id', id!)
  if (error) fail(500, 'update_failed')

  return { ok: true }
})
