import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail, failZod } from '../../utils/errors'

/**
 * POST /api/admin/referrals — create a referral code.
 * Body: { code, partner_name?, partner_phone?, commission_pct? }
 */
// Max 32: the landing form sends the code as source "ref:<code>", and
// /api/lead caps source at 40 characters — a longer code would make
// every lead from that partner's link fail validation.
const schema = z.object({
  code: z.string().min(2).max(32).regex(/^[a-z0-9-]+$/i),
  partner_name: z.string().max(120).optional().nullable(),
  partner_phone: z.string().max(20).optional().nullable(),
  commission_pct: z.number().min(0).max(100).optional().nullable(),
})

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

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    failZod(parsed.error, { code: 'invalid_referral_code', commission_pct: 'invalid_commission' })
  }

  const { data: created, error } = await admin
    .from('referrals')
    .insert({
      code: parsed.data.code.toLowerCase(),
      partner_name: parsed.data.partner_name ?? null,
      partner_phone: parsed.data.partner_phone ?? null,
      commission_pct: parsed.data.commission_pct ?? null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505' || /duplicate/i.test(error.message)) fail(409, 'duplicate_code')
    console.error('[admin/referrals] insert', error)
    fail(500, 'insert_failed')
  }

  return { ok: true, referral: created }
})
