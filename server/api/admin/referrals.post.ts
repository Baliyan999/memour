import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * POST /api/admin/referrals — create a referral code.
 * Body: { code, partner_name?, partner_phone?, commission_pct? }
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  code: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/i, 'code must be alphanumeric'),
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
  if (!parsed.success) fail(422, 'invalid_input')

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
    if (/duplicate/i.test(error.message)) fail(409, 'duplicate_code')
    fail(500, 'insert_failed')
  }

  return { ok: true, referral: created }
})
