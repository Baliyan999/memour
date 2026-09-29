import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { countsAsPaid } from '../../utils/payments'
import { fail } from '../../utils/errors'

/**
 * GET /api/admin/referrals — list referral codes with attribution
 * counts. Admin-only. Counts leads/events per code so the admin can
 * see at a glance which partner is bringing volume.
 *
 *   lead_count       — distinct phone numbers among the partner's
 *                      leads. /api/lead is public, so a raw row count
 *                      could be inflated by re-submitting the form;
 *                      the same number counts once.
 *   event_count      — events created from those leads (admin action,
 *                      can't be forged from outside).
 *   paid_event_count — of those, events with a settled payment: a
 *                      provider payment with a transaction id, or a
 *                      'manual' one the admin recorded by activating
 *                      the event by hand — the basis for commission.
 *                      Event status alone doesn't count: a draft can
 *                      be archived (cancelled) without ever being paid.
 *
 * Attributions are read page by page (PostgREST returns at most
 * max_rows = 1000 rows per select), with each event's payments embedded,
 * and aggregated here — no per-referral round trips and no id lists
 * in the URL, so the report stays exact however many rows there are.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', ((user as any).id ?? (user as any).sub))
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const { data: refs, error: refsErr } = await admin
    .from('referrals')
    .select('id, code, partner_name, partner_phone, commission_pct, created_at')
    .order('created_at', { ascending: false })
  if (refsErr) fail(500, 'list_failed')

  type Pay = { status: string; provider: string; provider_transaction_id: string | null }
  const attrs = []
  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from('referral_attributions')
      .select('referral_id, event_id, events!referral_attributions_event_id_fkey(payments(status, provider, provider_transaction_id)), leads(phone, converted_event_id, events!leads_converted_event_id_fkey(payments(status, provider, provider_transaction_id)))')
      .order('id')
      .range(from, from + 999)
    if (error) {
      console.error('[admin/referrals] attributions', error)
      fail(500, 'list_failed')
    }
    if (!data?.length) break
    attrs.push(...data)
    // Advance by what actually came back: correct whatever max_rows is.
    from += data.length
  }

  // Same rule as the payments flow: a paid row counts when money
  // really moved (provider transaction) or the admin recorded it.
  const settled = (pays: Pay[] | null | undefined) => (pays ?? []).some(countsAsPaid)

  // Older conversions only set leads.converted_event_id (the
  // attribution row never got its event_id) — count those too.
  const perRef = new Map<string, { phones: Set<string>; events: Set<string>; paid: Set<string> }>()
  for (const a of attrs) {
    const bucket = perRef.get(a.referral_id)
      ?? { phones: new Set<string>(), events: new Set<string>(), paid: new Set<string>() }
    perRef.set(a.referral_id, bucket)
    const lead = a.leads
    if (lead) {
      // Compare the last 9 digits: "+998 90 123 45 67", "998901234567"
      // and "901234567" are the same number.
      const digits = lead.phone.replace(/\D/g, '').slice(-9)
      if (digits) bucket.phones.add(digits)
    }
    const eventId = a.event_id ?? lead?.converted_event_id ?? null
    if (!eventId) continue
    bucket.events.add(eventId)
    const pays = a.event_id ? a.events?.payments : lead?.events?.payments
    if (settled(pays)) bucket.paid.add(eventId)
  }

  return {
    referrals: (refs ?? []).map((r) => {
      const b = perRef.get(r.id)
      return {
        ...r,
        lead_count: b?.phones.size ?? 0,
        event_count: b?.events.size ?? 0,
        paid_event_count: b?.paid.size ?? 0,
      }
    }),
  }
})
