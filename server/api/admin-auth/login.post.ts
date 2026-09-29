import { z } from 'zod'
import { createHash, randomInt } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendTelegram } from '../../utils/telegram'
import { closeOpenOtps, deleteOtp, insertOtp } from '../../utils/otp-store'
import { checkRateLimit, getTrustedClientIp } from '../../utils/rate-limit'
import { assertAdminSessionConfigured } from '../../utils/admin-session'
import { fail } from '../../utils/errors'

/**
 * POST /api/admin-auth/login — first step of admin login.
 *
 *   1. Verify email + password against Supabase Auth via the token
 *      endpoint (we discard the returned session — the client gets
 *      its real session only after the second step succeeds).
 *   2. Confirm the user is in the admins table.
 *   3. Generate a 6-digit code, hash + store in admin_otps.
 *   4. Send the code to the admin's Telegram chat via the Memour bot.
 *      If Telegram refuses (bot not started, wrong chat_id, token
 *      missing) the code is dropped and we say so — no "code sent"
 *      screen for a code that never left. Once it's delivered, older
 *      open codes for the email are closed.
 *   5. Return { ok: true } — the client moves to the code-entry step.
 *
 * Every Supabase /token call leaves from this server's single IP and
 * shares its per-IP quota, so we limit per client IP and per email
 * BEFORE calling it; a 429 from Supabase is reported as `rate_limited`,
 * not as a wrong password.
 *
 * Wrong email and wrong password both return `bad_credentials` so we
 * don't reveal whether an email exists in the system.
 */

const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(6).max(200),
})

const CODE_TTL_MS = 10 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 30_000
const HOUR_MS = 60 * 60 * 1000
const IP_MAX = 10 // login attempts per client IP per 10 minutes
const EMAIL_MAX = 20 // login attempts per email per hour
const CODES_PER_HOUR_MAX = 10 // Telegram codes per email per hour

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export default defineEventHandler(async (event) => {
  assertAdminSessionConfigured()

  const ip = getTrustedClientIp(event)
  if (!checkRateLimit('admin-login-ip', ip, IP_MAX, 10 * 60 * 1000)) fail(429, 'rate_limited')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(400, 'bad_credentials')

  const email = parsed.data.email.trim().toLowerCase()
  const password = parsed.data.password
  if (!checkRateLimit('admin-login-email', email, EMAIL_MAX, HOUR_MS)) fail(429, 'rate_limited')

  // --- 1. Verify password via Supabase Auth token endpoint ---
  const supabaseUrl = process.env.NUXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NUXT_PUBLIC_SUPABASE_KEY!
  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  }).catch((e) => {
    console.error('[admin-auth] token endpoint unreachable', e)
    fail(502, 'server_error')
  })
  if (tokenRes.status === 429) fail(429, 'rate_limited')
  if (!tokenRes.ok) fail(401, 'bad_credentials')
  const tokenJson = (await tokenRes.json()) as any
  const userId: string | undefined = tokenJson?.user?.id
  if (!userId) fail(401, 'bad_credentials')

  // --- 2. Confirm admin row + read chat_id ---
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id, telegram_chat_id, role')
    .eq('user_id', userId)
    .maybeSingle()
  if (!adminRow) fail(403, 'not_admin')
  const chatId = (adminRow as any).telegram_chat_id as string | null
  if (!chatId) fail(409, 'no_chat_id')

  // --- 3. Rate limit + generate code ---
  const now = Date.now()
  const count = () => admin.from('admin_otps').select('email', { count: 'exact', head: true })
  const [recent, lastHour] = await Promise.all([
    count().eq('email', email).gte('created_at', new Date(now - RATE_LIMIT_WINDOW_MS).toISOString()),
    count().eq('email', email).gte('created_at', new Date(now - HOUR_MS).toISOString()),
  ])
  if ((recent.count ?? 0) > 0) fail(429, 'too_many_requests')
  if ((lastHour.count ?? 0) >= CODES_PER_HOUR_MAX) fail(429, 'rate_limited')

  let fresh: { code: string; code_hash: string; created_at: string }
  try {
    fresh = await insertOtp(
      admin,
      'admin_otps',
      {
        email,
        expires_at: new Date(now + CODE_TTL_MS).toISOString(),
        ip,
        user_agent: getRequestHeader(event, 'user-agent') ?? null,
      },
      () => {
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
        return { code, code_hash: hashCode(email, code) }
      },
    )
  } catch (e) {
    console.error('[admin-auth] otp insert', e)
    fail(500, 'storage_error')
  }

  // --- 4. Send via Telegram ---
  const text =
    `🔐 Memour admin\n` +
    `Код входа: <b>${fresh.code}</b>\n` +
    `Действителен 10 минут. Если это были не вы — игнорируйте.`
  const sent = await sendTelegram(text, chatId)
  if (!sent.ok) {
    await deleteOtp(admin, 'admin_otps', 'email', email, fresh.code_hash).catch(() => {})
    fail(502, sent.unreachable ? 'telegram_unreachable' : 'telegram_failed')
  }
  await closeOpenOtps(admin, 'admin_otps', 'email', email, fresh.created_at).catch((e) =>
    console.error('[admin-auth] closing older codes failed', e),
  )

  return { ok: true, expires_in: CODE_TTL_MS / 1000 }
})
