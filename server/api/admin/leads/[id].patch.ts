import type { Database } from '~/types/database.types'
import { z } from 'zod'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

/**
 * PATCH /api/admin/leads/[id] — update status / notes on a lead.
 * Used by /admin/leads to walk leads through the new → contacted →
 * won / lost workflow.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  status: z.enum(['new', 'contacted', 'won', 'lost']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  converted_event_id: z.string().uuid().optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', ((user as any).id ?? (user as any).sub))
    .maybeSingle()
  if (!adminRow)
    fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    fail(400, 'invalid_id')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    fail(422, 'invalid_input')

  const updates: any = {}
  if (parsed.data.status !== undefined)
    updates.status = parsed.data.status
  if (parsed.data.notes !== undefined)
    updates.notes = parsed.data.notes
  if (parsed.data.converted_event_id !== undefined)
    updates.converted_event_id = parsed.data.converted_event_id

  const { error } = await admin.from('leads').update(updates).eq('id', id!)
  if (error)
    fail(500, 'update_failed')

  return { ok: true }
})
