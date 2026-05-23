import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * PATCH /api/couple/event/[id]/status — couple changes event status.
 *
 * Allowed transitions from the couple's side:
 *   draft  → active    (only after payment — currently we just check
 *                       payments.status = paid)
 *   active → archived  (after the wedding, before scheduled cleanup)
 *
 * Anything else (draft → archived, active → draft) is admin-only.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  status: z.enum(['active', 'archived']),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, status, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== user!.id) fail(403, 'forbidden')

  // Validate transition.
  const allowed =
    (ev!.status === 'draft' && parsed.data.status === 'active') ||
    (ev!.status === 'active' && parsed.data.status === 'archived')
  if (!allowed) fail(409, 'invalid_transition')

  // Draft → active requires at least one paid payment.
  if (ev!.status === 'draft' && parsed.data.status === 'active') {
    const { data: payments } = await admin
      .from('payments')
      .select('id')
      .eq('event_id', ev!.id)
      .eq('status', 'paid')
      .limit(1)
    if (!payments || payments.length === 0) fail(402, 'payment_required')
  }

  const { error } = await admin
    .from('events')
    .update({ status: parsed.data.status })
    .eq('id', ev!.id)
  if (error) fail(500, 'update_failed')

  return { ok: true }
})
