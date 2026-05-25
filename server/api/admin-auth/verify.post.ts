import { z } from 'zod'
import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * POST /api/admin-auth/verify — second (and final) step of admin login.
 *
 *   1. Verify the 6-digit Telegram code matches the open OTP row.
 *   2. Mark the OTP consumed (single use).
 *   3. Re-verify the password via Supabase Auth /token endpoint and
 *      return the freshly-minted { access_token, refresh_token } to the
 *      browser. The client then calls `supabase.auth.setSession()` which
 *      writes them into httpOnly cookies via the Nuxt Supabase adapter.
 *
 * No magic-link, no token in the URL fragment — the session is
 * delivered over the JSON response and lands directly in cookies.
 *
 * Why the password is sent here again, not just the code:
 *   - Real 2FA requires both factors to mint a session. If we issued a
 *     session on "code valid" alone, someone who intercepted the TG
 *     code could log in without ever knowing the password. By requiring
 *     a fresh password proof at the verify step, neither factor in
 *     isolation produces access.
 *   - The password lives in the browser's memory between the two
 *     steps; HTTPS protects it on the wire.
 */
const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(6).max(200),
  code: z.string().regex(/^\d{6}$/),
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

  // --- 1. Find the open OTP row matching this code ---
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

  // --- 2. Mark consumed before anything else (prevents replay even
  //        if subsequent steps fail) ---
  await admin
    .from('admin_otps')
    .update({ consumed_at: new Date().toISOString() } as any)
    .eq('email', email)
    .eq('code_hash', code_hash)

  // --- 3. Re-verify password + mint session ---
  const supabaseUrl = process.env.NUXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NUXT_PUBLIC_SUPABASE_KEY!
  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: parsed.data.password }),
  })
  if (!tokenRes.ok) fail(401, 'session_failed')
  const tokenJson = (await tokenRes.json()) as any
  if (!tokenJson?.access_token || !tokenJson?.refresh_token) fail(500, 'session_failed')

  return {
    ok: true,
    access_token: tokenJson.access_token as string,
    refresh_token: tokenJson.refresh_token as string,
  }
})
