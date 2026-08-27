import type { Database } from '~/types/database.types'
import { createHash, randomInt } from 'node:crypto'
import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import { sendTelegram } from '../../utils/telegram'

/**
 * POST /api/admin-auth/login — first step of admin login.
 *
 *   1. Verify email + password against Supabase Auth via the token
 *      endpoint (we discard the returned session — the client gets
 *      its real session only after the second step succeeds).
 *   2. Confirm the user is in the admins table.
 *   3. Generate a 6-digit code, hash + store in admin_otps.
 *   4. Send the code to the admin's Telegram chat via the Memour bot.
 *   5. Return { ok: true } — the client moves to the code-entry step.
 *
 * All failure modes return a generic "wrong credentials" code so we
 * don't reveal whether an email exists in the system.
 */

const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(6).max(200),
})

const CODE_TTL_MS = 10 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 30_000

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${email}:${code}`).digest('hex')
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    fail(400, 'bad_credentials')

  const email = parsed.data.email.trim().toLowerCase()
  const password = parsed.data.password

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
  })
  if (!tokenRes.ok)
    fail(401, 'bad_credentials')
  const tokenJson = (await tokenRes.json()) as any
  const userId: string | undefined = tokenJson?.user?.id
  if (!userId)
    fail(401, 'bad_credentials')

  // --- 2. Confirm admin row + read chat_id ---
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id, telegram_chat_id, role')
    .eq('user_id', userId)
    .maybeSingle()
  if (!adminRow)
    fail(403, 'not_admin')
  const chatId = (adminRow as any).telegram_chat_id as string | null
  if (!chatId)
    fail(409, 'no_chat_id')

  // --- 3. Rate limit + generate code ---
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { data: recent } = await admin
    .from('admin_otps')
    .select('created_at')
    .eq('email', email)
    .is('consumed_at', null)
    .gte('created_at', since)
    .limit(1)
  if (recent && recent.length > 0)
    fail(429, 'too_many_requests')

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const code_hash = hashCode(email, code)
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString()
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? null
  const ua = getRequestHeader(event, 'user-agent') ?? null

  const { error: insertErr } = await admin
    .from('admin_otps')
    .insert({ email, code_hash, expires_at, ip, user_agent: ua } as any)
  if (insertErr) {
    console.error('[admin-auth] otp insert', insertErr)
    fail(500, 'storage_error')
  }

  // --- 4. Send via Telegram ---
  const text
    = `🔐 Memour admin\n`
      + `Код входа: <b>${code}</b>\n`
      + `Действителен 10 минут. Если это были не вы — игнорируйте.`
  try {
    await sendTelegram(text, chatId)
  }
  catch (e) {
    console.error('[admin-auth] tg send failed', e)
    fail(502, 'telegram_failed')
  }

  return { ok: true, expires_in: CODE_TTL_MS / 1000 }
})
