import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { serverSupabaseServiceRole, serverSupabaseUser } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from './errors'

/**
 * Server-side proof that an admin finished the Telegram 2FA step.
 *
 * A Supabase session on its own is NOT admin access: anyone holding an
 * admin's password can mint one straight from GoTrue with the public
 * anon key, and email magic links produce sessions too. So after
 * /api/admin-auth/verify accepts the Telegram code it also sets
 * `memour-admin-2fa` — an httpOnly cookie signed with
 * ADMIN_SESSION_SECRET (HMAC-SHA256) over
 *
 *     <user_id>.<session_id>.<exp>
 *
 * `session_id` is the GoTrue session the code was entered for (JWT
 * claim; it survives token refreshes). A new login — magic link,
 * password grant, another person on the same browser — is a new
 * session, so an old cookie never carries over. Logout clears it too.
 *
 * `requireAdminSession(event)` is the single check used by
 * server/middleware/admin-guard.ts (every /api/admin/**) and by
 * /api/admin-auth/status (the page middleware): valid cookie for the
 * CURRENT session user + a row in public.admins.
 *
 * Production fails closed without a secret (>= 32 chars): no admin
 * access at all rather than a guessable signature. Local dev gets a
 * per-process random secret, i.e. re-login after a server restart.
 */
export const ADMIN_2FA_COOKIE = 'memour-admin-2fa'
// Same lifetime as the Supabase session cookies (nuxt.config).
const TTL_S = 60 * 60 * 8

let devSecret: string | null = null
function secret(): string | null {
  const s = process.env.ADMIN_SESSION_SECRET
  if (s && s.length >= 32) return s
  if (process.env.NODE_ENV === 'production') return null
  devSecret ??= randomBytes(32).toString('hex')
  return devSecret
}

/** Refuse admin login early when no signing secret is configured. */
export function assertAdminSessionConfigured() {
  if (secret()) return
  console.error('[admin-session] ADMIN_SESSION_SECRET missing or shorter than 32 chars — admin access disabled')
  fail(503, 'admin_auth_unavailable')
}

function sign(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url')
}

function cookieOptions(event: H3Event) {
  const https =
    useRuntimeConfig().public.siteUrl.startsWith('https://') ||
    getRequestProtocol(event, { xForwardedProto: true }) === 'https'
  return { httpOnly: true, secure: https, sameSite: 'lax' as const, path: '/' }
}

export function issueAdminSession(event: H3Event, userId: string, sessionId: string) {
  const key = secret()
  if (!key) fail(503, 'admin_auth_unavailable')
  const exp = Math.floor(Date.now() / 1000) + TTL_S
  const payload = `${userId}.${sessionId}.${exp}`
  setCookie(event, ADMIN_2FA_COOKIE, `${payload}.${sign(payload, key)}`, {
    ...cookieOptions(event),
    maxAge: TTL_S,
  })
}

export function clearAdminSession(event: H3Event) {
  deleteCookie(event, ADMIN_2FA_COOKIE, cookieOptions(event))
}

export interface AdminContext {
  userId: string
  role: string
}

export async function requireAdminSession(event: H3Event): Promise<AdminContext> {
  const key = secret()
  if (!key) fail(503, 'admin_auth_unavailable')

  // Throws on a broken/expired JWT — that's just "not logged in".
  const claims = (await serverSupabaseUser(event).catch(() => null)) as any
  const uid: string | undefined = claims?.sub ?? claims?.id
  if (!uid) fail(401, 'unauthorized')

  const parts = (getCookie(event, ADMIN_2FA_COOKIE) ?? '').split('.')
  if (parts.length !== 4) fail(401, 'admin_2fa_required')
  const [cUser, cSession, cExp, sig] = parts as [string, string, string, string]
  const expected = Buffer.from(sign(`${cUser}.${cSession}.${cExp}`, key))
  const given = Buffer.from(sig)
  const valid =
    given.length === expected.length &&
    timingSafeEqual(given, expected) &&
    Number(cExp) * 1000 > Date.now() &&
    cUser === uid &&
    cSession === String(claims?.session_id ?? '')
  if (!valid) fail(401, 'admin_2fa_required')

  const db = serverSupabaseServiceRole<Database>(event)
  const { data: row } = await db
    .from('admins')
    .select('user_id, role')
    .eq('user_id', uid)
    .maybeSingle()
  if (!row) fail(403, 'not_admin')
  return { userId: uid, role: row.role }
}

/** `session_id` + `sub` of a freshly minted access token (from GoTrue itself, so not re-verified). */
export function sessionOfAccessToken(accessToken: string): { userId: string; sessionId: string } | null {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
    if (typeof claims?.sub !== 'string' || typeof claims?.session_id !== 'string') return null
    return { userId: claims.sub, sessionId: claims.session_id }
  } catch {
    return null
  }
}
