import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { userId } from '../../../../utils/auth'
import { fail } from '../../../../utils/errors'
import { hitRateLimit } from '../../../../utils/rate-limit'
import { UUID_RE } from '../../../../utils/payments'
import { LINK_TOKEN_TTL_MS, botUsername, coupleBotReady, newLinkToken } from '../../../../utils/telegram-couple'

/**
 * POST /api/couple/telegram/link/[eventId] — a one-time deep link that
 * connects a Telegram chat to the event's notifications.
 *
 * Body: { locale: 'uz' | 'ru' } — the language the bot will use with
 * that chat (the dashboard's).
 *
 * The event's owner only, and only when its tier includes the bot (Pro
 * and up, before or after payment) — else 403 not_in_plan. A purged
 * album has nothing left to report (409 event_purged). 503
 * telegram_unavailable when the server can't run the bot (token,
 * username or webhook secret missing).
 *
 * Answers { url: https://t.me/<bot>?start=<token>, expires_at }. The
 * token is 32 random bytes; only its sha256 is stored, for 15 minutes,
 * and the webhook consumes it once. Never cached.
 */
const schema = z.object({ locale: z.enum(['uz', 'ru']).default('uz') })

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const uid = await userId(event)
  if (!uid) fail(401, 'unauthorized')

  const eventId = getRouterParam(event, 'eventId')
  if (!eventId || !UUID_RE.test(eventId)) fail(400, 'invalid_id')

  const parsed = schema.safeParse((await readBody(event).catch(() => null)) ?? {})
  if (!parsed.success) fail(422, 'invalid_input')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: ev, error } = await admin
    .from('events')
    .select('id, owner_id, plan_tier, purged_at')
    .eq('id', eventId!)
    .maybeSingle()
  if (error) fail(500, 'lookup_failed')
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== uid) fail(403, 'forbidden')
  if (!tierHas(ev!.plan_tier, 'telegram_bot')) fail(403, 'not_in_plan')
  if (ev!.purged_at) fail(409, 'event_purged')
  if (!coupleBotReady()) fail(503, 'telegram_unavailable')

  // A person needs one link at a time; this only stops a runaway loop.
  const hit = hitRateLimit('tg-link', uid!, 10, 10 * 60_000)
  if (!hit.ok) {
    setResponseHeader(event, 'Retry-After', hit.retryAfterSec)
    fail(429, 'rate_limited')
  }

  const { token, hash } = newLinkToken()
  const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString()
  const { error: insErr } = await admin.from('telegram_link_tokens').insert({
    token_hash: hash,
    event_id: ev!.id,
    user_id: uid!,
    locale: parsed.data!.locale,
    expires_at: expiresAt,
  })
  if (insErr) {
    console.error('[couple/telegram] token insert failed', insErr.code)
    fail(500, 'create_failed')
  }

  return { url: `https://t.me/${botUsername()}?start=${token}`, expires_at: expiresAt }
})
