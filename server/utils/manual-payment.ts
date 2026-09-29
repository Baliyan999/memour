import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getTierPriceTiyin } from './pricing'
import { countsAsPaid } from './payments'

/**
 * Offline payments (cash, bank transfer) the admin confirms by making
 * an event active by hand. They're recorded as a `payments` row with
 * provider 'manual', so "was this event paid?" has one answer for every
 * event — the referral report counts partner commission from it, and
 * archiving the event later doesn't erase the fact that it was paid.
 */
type Admin = ReturnType<typeof serverSupabaseServiceRole<Database>>

/**
 * Record a manual payment unless the event already has a settled one
 * (a provider payment with a transaction id, or an earlier manual one).
 */
export async function recordManualPayment(
  admin: Admin,
  ev: { id: string; plan_tier: string | null },
  adminId: string,
) {
  const { data: paid, error: readErr } = await admin
    .from('payments')
    .select('status, provider, provider_transaction_id')
    .eq('event_id', ev.id)
    .eq('status', 'paid')
  if (readErr) throw readErr
  if (paid?.some(countsAsPaid)) return
  // plan_tier is CHECK-constrained to the priced tiers (NULL = basic),
  // so this only trips on a new tier that has no price yet.
  const amount = getTierPriceTiyin(ev.plan_tier)
  if (amount === null) throw new Error(`no price for tier ${ev.plan_tier}`)
  const { error } = await admin.from('payments').insert({
    event_id: ev.id,
    provider: 'manual',
    amount,
    currency: 'UZS',
    status: 'paid',
    metadata: { recorded_by: adminId, recorded_at: new Date().toISOString() },
  })
  if (error) throw error
}

/** The admin took an event back to draft: its manual payment didn't happen. */
export async function cancelManualPayments(admin: Admin, eventId: string) {
  const { error } = await admin
    .from('payments')
    .update({ status: 'cancelled' })
    .eq('event_id', eventId)
    .eq('provider', 'manual')
    .eq('status', 'paid')
  if (error) throw error
}
