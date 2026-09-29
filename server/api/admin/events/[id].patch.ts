import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { recordManualPayment, cancelManualPayments } from '../../../utils/manual-payment'
import { fail, failZod } from '../../../utils/errors'

/**
 * PATCH /api/admin/events/[id] — fix an event after creation.
 *
 * Typos in names / date / table count end up on the printed cards,
 * and an event paid offline (cash, transfer) has no other way to go
 * from draft to active. Every field is optional; only the ones sent
 * are changed.
 *
 * owner_phone can only change while nobody has claimed the event yet
 * (owner_id is null) — after the couple's first SMS login the phone
 * no longer decides anything.
 *
 * Making an event active by hand records a 'manual' payment (the admin
 * is confirming an offline payment); taking it back to draft cancels
 * that record. Archiving leaves payments alone.
 */
const bodySchema = z.object({
  couple_names: z.string().trim().min(2).max(120).optional(),
  wedding_date: z.string().date().optional(),
  venue_name: z.string().max(160).nullable().optional(),
  table_count: z.number().int().min(1).max(200).optional(),
  plan_tier: z.enum(['basic', 'pro', 'premium', 'luxury']).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  owner_phone: z.string().regex(/^\+998\d{9}$/).optional(),
}).strict()

const FIELD_CODES = {
  couple_names: 'invalid_names',
  wedding_date: 'invalid_date',
  table_count: 'invalid_table_count',
  owner_phone: 'invalid_phone',
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const adminId: string = (user as any).id ?? (user as any).sub
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', adminId)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) failZod(parsed.error, FIELD_CODES)
  const updates = parsed.data

  const { data: ev } = await admin
    .from('events').select('id, status, plan_tier, owner_id, owner_phone').eq('id', id!).maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (updates.owner_phone !== undefined && updates.owner_phone !== ev!.owner_phone && ev!.owner_id) {
    fail(409, 'already_claimed')
  }
  if (!Object.keys(updates).length) return { ok: true }

  const { data: saved, error } = await admin
    .from('events')
    .update(updates)
    .eq('id', id!)
    .select('id, couple_names, wedding_date, venue_name, status, plan_tier, owner_id, owner_phone, table_count')
    .single()
  if (error || !saved) {
    console.error('[admin/events] update', error)
    fail(500, 'update_failed')
  }

  // The status change itself is saved either way; a failed payment
  // record only affects the referral report, so log it and go on.
  try {
    if (updates.status === 'active' && ev!.status !== 'active') {
      await recordManualPayment(admin, saved!, adminId)
    } else if (updates.status === 'draft' && ev!.status !== 'draft') {
      await cancelManualPayments(admin, saved!.id)
    }
  } catch (e) {
    console.error('[admin/events] manual payment', e)
  }
  return { ok: true, event: saved }
})
