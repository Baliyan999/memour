import type { Database } from '~/types/database.types'
import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import { sendSms } from '../../../utils/eskiz'
import { generateCode, hashCode, normalizePhone } from '../../../utils/phone-otp'

/**
 * POST /api/auth/phone/send — start a phone-based login. Generates a
 * 6-digit OTP, stores its hash in `phone_otps`, and sends the SMS via
 * Eskiz. Codes expire in 5 minutes. To prevent abuse we rate-limit
 * to one fresh send per phone per 30 seconds.
 *
 * In Eskiz' test mode we are forced to send a fixed template like
 * "This is test from Eskiz" — so the code we log to the server
 * console while DEV is what the user actually needs to type. Once
 * the custom Memour template is approved, we'll embed {code} for real.
 */
const schema = z.object({ phone: z.string().min(7).max(20) })

const RATE_LIMIT_WINDOW_MS = 30_000
const CODE_TTL_MS = 5 * 60 * 1000

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    fail(422, 'invalid_phone')

  const phone = normalizePhone(parsed.data.phone)
  if (!phone)
    fail(422, 'invalid_phone')

  const admin = serverSupabaseServiceRole<Database>(event)

  // Rate-limit: refuse a fresh send if a non-consumed code was issued
  // for this phone within the past 30 seconds.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { data: recent } = await admin
    .from('phone_otps')
    .select('created_at')
    .eq('phone', phone)
    .is('consumed_at', null)
    .gte('created_at', since)
    .limit(1)
  if (recent && recent.length > 0)
    fail(429, 'too_many_requests')

  const code = generateCode()
  const code_hash = hashCode(phone, code)
  const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString()
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? null
  const ua = getRequestHeader(event, 'user-agent') ?? null

  const { error: insertErr } = await admin.from('phone_otps').insert({
    phone,
    code_hash,
    expires_at,
    ip,
    user_agent: ua,
  })
  if (insertErr) {
    console.error('[phone-otp] insert failed', insertErr)
    fail(500, 'storage_error')
  }

  // Pick message template depending on Eskiz mode. In test mode only
  // sanctioned templates are accepted, so we send the literal test
  // string and log the actual code to the server console. After the
  // production template is approved by Eskiz, swap by flipping
  // ESKIZ_USE_TEST_TEMPLATE=false in .env. The production text below
  // MUST be byte-for-byte identical to the approved template (sans
  // the {code} placeholder) — Eskiz rejects messages whose structure
  // diverges from any approved template.
  const useTestTemplate = process.env.ESKIZ_USE_TEST_TEMPLATE !== 'false'
  const message = useTestTemplate
    ? 'Bu Eskiz dan test'
    : `Код подтверждения для входа на сайт Memour: ${code}. Никому не сообщайте код.`

  console.log(`[phone-otp] code for ${phone}: ${code} (DEV LOG)`)

  const send = await sendSms(phone, message)
  if (!send.ok) {
    console.error('[phone-otp] SMS send failed', send.error)
    // We still return ok=true so user can retry; the code is in DB.
    // But in production we should propagate the failure.
    if (process.env.NODE_ENV === 'production')
      fail(502, 'sms_send_failed')
  }

  // In test mode (Eskiz won't deliver our actual {code}) we leak the
  // code back in the response so the dev UI can show it as a banner.
  // Strip this branch the moment the production template is approved.
  return {
    ok: true,
    expires_in: CODE_TTL_MS / 1000,
    dev_code: useTestTemplate ? code : undefined,
  }
})
