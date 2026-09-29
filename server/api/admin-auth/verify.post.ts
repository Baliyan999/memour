import { z } from 'zod'
import { createHash } from 'node:crypto'
import {
  serverSupabaseClient,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { OTP_MAX_ATTEMPTS, consumeOtp, otpHashMatches, spendOtpAttempt } from '../../utils/otp-store'
import { checkRateLimit, getTrustedClientIp } from '../../utils/rate-limit'
import {
  assertAdminSessionConfigured,
  issueAdminSession,
  sessionOfAccessToken,
} from '../../utils/admin-session'
import { fail } from '../../utils/errors'

/**
 * POST /api/admin-auth/verify — second (and final) step of admin login.
 *
 *   1. Spend one attempt on the newest open OTP for the email, then
 *      compare (constant time). Five checks per code; after that a new
 *      code must be requested.
 *   2. Mark the OTP consumed (single use).
 *   3. Re-verify the password via Supabase Auth /token endpoint to
 *      mint a fresh session, then call `setSession` on the server-bound
 *      Supabase client — that writes the session cookies into the
 *      response via `@supabase/ssr`'s cookie adapter in EXACTLY the
 *      format the matching server reader (`serverSupabaseUser`) expects.
 *   4. Set the signed `memour-admin-2fa` cookie for that user + session
 *      (utils/admin-session.ts). /api/admin/** and the /admin pages
 *      require it, so a session minted any other way — straight from
 *      GoTrue with the password, or an email magic link — is not
 *      admin access.
 *
 * The access_token / refresh_token never leave the server — the
 * response body just says `{ ok: true }`. No URL fragment, no JSON
 * token leak, just cookies that match what the SSR layer reads.
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

const IP_VERIFY_MAX = 20
const IP_VERIFY_WINDOW_MS = 10 * 60 * 1000

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export default defineEventHandler(async (event) => {
  assertAdminSessionConfigured()
  if (!checkRateLimit('admin-verify-ip', getTrustedClientIp(event), IP_VERIFY_MAX, IP_VERIFY_WINDOW_MS)) {
    fail(429, 'rate_limited')
  }

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const email = parsed.data.email.trim().toLowerCase()
  const admin = serverSupabaseServiceRole<Database>(event)

  // --- 1. Spend an attempt on the open code, then compare ---
  const attempt = await spendOtpAttempt(admin, 'admin_otps', 'email', email).catch((e) => {
    console.error('[admin-auth/verify] attempt lookup failed', e)
    fail(500, 'storage_error')
  })
  if (attempt.status === 'none') fail(410, 'code_expired')
  if (attempt.status === 'locked') fail(429, 'too_many_attempts')
  if (attempt.status === 'busy') fail(429, 'rate_limited')
  if (!otpHashMatches(hashCode(email, parsed.data.code), attempt.codeHash)) {
    if (attempt.attempts >= OTP_MAX_ATTEMPTS) fail(429, 'too_many_attempts')
    fail(401, 'invalid_code')
  }

  // --- 2. Mark consumed before anything else (prevents replay even
  //        if subsequent steps fail) ---
  if (!(await consumeOtp(admin, 'admin_otps', 'email', email, attempt.codeHash))) {
    fail(410, 'code_expired')
  }

  // --- 3. Re-verify password + mint session ---
  const supabaseUrl = process.env.NUXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NUXT_PUBLIC_SUPABASE_KEY!
  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: parsed.data.password }),
  }).catch((e) => {
    console.error('[admin-auth/verify] token endpoint unreachable', e)
    fail(502, 'server_error')
  })
  if (tokenRes.status === 429) fail(429, 'rate_limited')
  if (!tokenRes.ok) fail(401, 'session_failed')
  const tokenJson = (await tokenRes.json()) as any
  if (!tokenJson?.access_token || !tokenJson?.refresh_token) fail(500, 'session_failed')
  const minted = sessionOfAccessToken(tokenJson.access_token)
  if (!minted) fail(500, 'session_failed')

  // --- 4. Write session cookies to the response server-side. The
  //        @nuxtjs/supabase server client uses @supabase/ssr's cookie
  //        adapter under the hood, so setSession() goes straight into
  //        Set-Cookie headers in the exact format `serverSupabaseUser`
  //        reads on the next request. No client-side setSession needed.
  const userClient = await serverSupabaseClient<Database>(event)
  const { error: sessErr } = await userClient.auth.setSession({
    access_token: tokenJson.access_token,
    refresh_token: tokenJson.refresh_token,
  })
  if (sessErr) {
    console.error('[admin-auth/verify] setSession on server failed', sessErr)
    fail(500, 'session_failed')
  }

  // --- 5. Proof of the second factor for this exact session ---
  issueAdminSession(event, minted.userId, minted.sessionId)

  return { ok: true }
})
