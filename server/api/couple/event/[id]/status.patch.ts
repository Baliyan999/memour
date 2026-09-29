import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getTierPriceTiyin } from '../../../../utils/pricing'
import { countsAsPaid, weddingDayStartMs } from '../../../../utils/payments'
import { uploadWindow } from '../../../../utils/upload-window'
import { fail } from '../../../../utils/errors'

/**
 * PATCH /api/couple/event/[id]/status — couple changes event status.
 *
 * Allowed transitions from the couple's side:
 *   draft  → active    (only with a paid payment that covers the event's
 *                       current tier — normally the webhook already did it)
 *   active → archived  (once the wedding upload window opens, before
 *                       scheduled cleanup; irreversible, so never weeks
 *                       early by mistake)
 *
 * Anything else (draft → archived, active → draft) is admin-only.
 */
const schema = z.object({
  status: z.enum(['active', 'archived']),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, status, owner_id, plan_tier, wedding_date')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')

  // Validate transition.
  const allowed =
    (ev!.status === 'draft' && parsed.data.status === 'active') ||
    (ev!.status === 'active' && parsed.data.status === 'archived')
  if (!allowed) fail(409, 'invalid_transition')

  // Draft → active requires a real paid payment for the current tier.
  if (ev!.status === 'draft' && parsed.data.status === 'active') {
    const price = getTierPriceTiyin(ev!.plan_tier)
    const { data: payments, error: payErr } = await admin
      .from('payments')
      .select('status, provider, provider_transaction_id, amount')
      .eq('event_id', ev!.id)
      .eq('status', 'paid')
    if (payErr) fail(500, 'storage_error')
    const covered = price !== null && (payments ?? []).some((p) => countsAsPaid(p) && p.amount >= price)
    if (!covered) fail(402, 'payment_required')
  }

  // Archiving closes uploads for good — not before the wedding. Allowed
  // from when uploads open (server/utils/upload-window.ts: 18:00 the
  // evening before), so it still works as an emergency stop at the party.
  const opensAt = uploadWindow(ev!.wedding_date)?.opensAt.getTime() ?? weddingDayStartMs(ev!.wedding_date)
  if (parsed.data.status === 'archived' && Date.now() < opensAt) {
    fail(409, 'archive_before_wedding')
  }

  // Conditional on the status we checked, so a concurrent change can't
  // be overwritten.
  const { data: updated, error } = await admin
    .from('events')
    .update({ status: parsed.data.status })
    .eq('id', ev!.id)
    .eq('status', ev!.status)
    .select('id')
  if (error) fail(500, 'update_failed')
  if (!updated?.length) fail(409, 'invalid_transition')

  return { ok: true }
})
