import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * GET /api/admin/referrals — list referral codes with attribution
 * counts. Admin-only. Counts leads/events per code so the admin can
 * see at a glance which partner is bringing volume.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', user!.id)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const { data: refs } = await admin
    .from('referrals')
    .select('id, code, partner_name, partner_phone, commission_pct, created_at')
    .order('created_at', { ascending: false })

  // For each referral, count attributions. Done in a follow-up query
  // since PostgREST doesn't aggregate in a single select-with-relation
  // call without a view.
  const out: Array<any> = []
  for (const r of refs ?? []) {
    const { count: leadCount } = await admin
      .from('referral_attributions')
      .select('id', { count: 'exact', head: true })
      .eq('referral_id', r.id)
      .not('lead_id', 'is', null)
    const { count: eventCount } = await admin
      .from('referral_attributions')
      .select('id', { count: 'exact', head: true })
      .eq('referral_id', r.id)
      .not('event_id', 'is', null)
    out.push({ ...r, lead_count: leadCount ?? 0, event_count: eventCount ?? 0 })
  }
  return { referrals: out }
})
