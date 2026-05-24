import { z } from 'zod'
import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * POST /api/admin-auth/verify — second step of admin login.
 *
 *   1. Verify the 6-digit code matches the open OTP row.
 *   2. Mark OTP consumed.
 *   3. Generate a one-time magic-link via Supabase admin API.
 *   4. Return { action_link } — the client navigates there and
 *      Supabase sets the real session cookies on redirect.
 *
 * The admin's password isn't re-verified here; the OTP being valid
 * proves both: that they passed the password step earlier (we only
 * create OTPs after a successful password check) and that they
 * control the Telegram chat the code was sent to.
 */
const schema = z.object({
  email: z.string().email().max(160),
  code: z.string().regex(/^\d{6}$/),
  locale: z.enum(['ru', 'uz']).optional(),
})

const MAX_ATTEMPTS = 5

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const email = parsed.data.email.trim().toLowerCase()
  const code_hash = hashCode(email, parsed.data.code)
  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: otp } = await admin
    .from('admin_otps')
    .select('email, code_hash, expires_at, consumed_at, attempts')
    .eq('email', email)
    .eq('code_hash', code_hash)
    .is('consumed_at', null)
    .maybeSingle()

  if (!otp) fail(401, 'invalid_code')
  if (new Date(otp.expires_at).getTime() < Date.now()) fail(410, 'code_expired')
  if (((otp as any).attempts ?? 0) >= MAX_ATTEMPTS) fail(429, 'too_many_attempts')

  await admin
    .from('admin_otps')
    .update({ consumed_at: new Date().toISOString() } as any)
    .eq('email', email)
    .eq('code_hash', code_hash)

  // Generate magic link — Supabase will validate it and set session.
  const config = useRuntimeConfig()
  const locale = parsed.data.locale ?? 'uz'
  const redirectTo = `${config.public.siteUrl}/${locale}/admin`
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  })
  if (linkErr || !link?.properties?.action_link) {
    console.error('[admin-auth/verify] generateLink failed', linkErr)
    fail(500, 'link_failed')
  }

  return { ok: true, action_link: link!.properties!.action_link }
})
