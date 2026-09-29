import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendSms } from '../../../utils/eskiz'
import { sendTelegram } from '../../../utils/telegram'
import { generateCode, hashCode, maskPhone, normalizePhone } from '../../../utils/phone-otp'
import { closeOpenOtps, deleteOtp, insertOtp } from '../../../utils/otp-store'
import { checkRateLimit, getTrustedClientIp } from '../../../utils/rate-limit'
import { fail, failZod } from '../../../utils/errors'
import { consentField, requireConsent } from '../../../utils/consent'

/**
 * POST /api/auth/phone/send — start a phone-based login. Generates a
 * 6-digit OTP, stores its hash in `phone_otps`, and sends the SMS via
 * Eskiz. Codes expire in 5 minutes; once a new code is delivered the
 * older ones are closed (if the SMS fails, the previous code keeps
 * working).
 *
 * The code reaches the user ONLY by SMS — never in the response, never
 * in production logs. ESKIZ_USE_TEST_TEMPLATE=true only switches the
 * SMS text to Eskiz' fixed test string (which can't carry the code); in
 * production that would lock everyone out silently, so we answer
 * `sms_unavailable` instead and the couple can use the email channel.
 * `nuxt dev` alone prints the code to the server console and treats a
 * failed SMS as delivered, so local login works without Eskiz; that
 * branch is compiled out of production builds.
 *
 * Limits against SMS pumping / brute force, all counted from
 * `phone_otps` rows (every code sent leaves one), so they survive
 * restarts:
 *   - one open code per phone per 30 s (the UI's resend timer);
 *   - PHONE_HOURLY_MAX per phone and IP_HOURLY_MAX per client IP;
 *   - GLOBAL_HOURLY_MAX for the whole site (OTP_SMS_HOURLY_CAP env) —
 *     past it SMS login pauses and the founder gets a Telegram alert;
 *   - plus an in-memory per-IP burst limit checked before any DB work.
 * These caps double as a DoS lever — someone who knows a couple's number
 * can use up its hourly codes, a botnet can hit the site-wide cap. A
 * deliberate trade-off against paying for pumped SMS: couples can always
 * fall back to the email link.
 *
 * No code goes out before the couple has ticked the terms and the
 * privacy policy (`consent`, see server/utils/consent.ts): sending the
 * SMS already hands the number to Eskiz. The consent record itself is
 * written by /verify, once we know whose account it is.
 */
const schema = z.object({ phone: z.string().min(7).max(20), consent: consentField })

const RATE_LIMIT_WINDOW_MS = 30_000
const CODE_TTL_MS = 5 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const PHONE_HOURLY_MAX = 5
// Mobile carriers put many subscribers behind one NAT address.
const IP_HOURLY_MAX = 20
const IP_BURST_MAX = 5
const GLOBAL_HOURLY_MAX = Number(process.env.OTP_SMS_HOURLY_CAP) || 200

// One "SMS cap reached" alert per hour per process is plenty.
let lastCapAlertAt = 0
function alertSmsCap(count: number) {
  console.error(`[phone-otp] global SMS cap reached: ${count} codes in the last hour`)
  if (Date.now() - lastCapAlertAt < HOUR_MS) return
  lastCapAlertAt = Date.now()
  void sendTelegram(
    `⚠️ Memour: за последний час отправлено ${count} SMS-кодов (лимит ${GLOBAL_HOURLY_MAX}). ` +
      `Вход по SMS приостановлен до спада нагрузки — похоже на накрутку.`,
  )
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) failZod(parsed.error, { phone: 'invalid_phone', consent: 'consent_required' }, 'invalid_phone')

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) fail(422, 'invalid_phone')

  requireConsent('login', parsed.data.consent)

  // Eskiz accepts only pre-approved texts. Until the Memour template
  // ("Код подтверждения для входа на сайт Memour: {code}. Никому не
  // сообщайте код.") is approved, the account can send only the fixed
  // test string — which doesn't contain the code.
  const useTestTemplate = process.env.ESKIZ_USE_TEST_TEMPLATE === 'true'
  if (useTestTemplate && process.env.NODE_ENV === 'production') {
    console.error('[phone-otp] ESKIZ_USE_TEST_TEMPLATE=true in production — SMS login is off')
    fail(503, 'sms_unavailable')
  }

  const ip = getTrustedClientIp(event)
  if (!checkRateLimit('otp-send-ip', ip, IP_BURST_MAX, 60_000)) fail(429, 'rate_limited')

  const admin = serverSupabaseServiceRole<Database>(event)
  const now = Date.now()
  const hourAgo = new Date(now - HOUR_MS).toISOString()
  const count = () => admin.from('phone_otps').select('phone', { count: 'exact', head: true })
  const [last, perPhone, perIp, site] = await Promise.all([
    admin
      .from('phone_otps')
      .select('created_at')
      .eq('phone', phone)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    count().eq('phone', phone).gte('created_at', hourAgo),
    count().eq('ip', ip).gte('created_at', hourAgo),
    count().gte('created_at', hourAgo),
  ])
  const dbErr = last.error ?? perPhone.error ?? perIp.error ?? site.error
  if (dbErr) {
    console.error('[phone-otp] limit lookup failed', dbErr)
    fail(500, 'storage_error')
  }
  if (last.data && now - new Date(last.data.created_at).getTime() < RATE_LIMIT_WINDOW_MS) {
    fail(429, 'too_many_requests')
  }
  if ((perPhone.count ?? 0) >= PHONE_HOURLY_MAX || (perIp.count ?? 0) >= IP_HOURLY_MAX) {
    fail(429, 'rate_limited')
  }
  if ((site.count ?? 0) >= GLOBAL_HOURLY_MAX) {
    alertSmsCap(site.count ?? 0)
    fail(503, 'sms_unavailable')
  }

  let fresh: { code: string; code_hash: string; created_at: string }
  try {
    fresh = await insertOtp(
      admin,
      'phone_otps',
      {
        phone,
        expires_at: new Date(now + CODE_TTL_MS).toISOString(),
        ip,
        user_agent: getRequestHeader(event, 'user-agent') ?? null,
      },
      () => {
        const code = generateCode()
        return { code, code_hash: hashCode(phone, code) }
      },
    )
  } catch (e) {
    console.error('[phone-otp] insert failed', e)
    fail(500, 'storage_error')
  }

  // The production text below MUST be byte-for-byte identical to the
  // approved template (with the code in place of {code}) — Eskiz
  // rejects messages whose structure diverges from an approved one.
  const message = useTestTemplate
    ? 'Bu Eskiz dan test'
    : `Код подтверждения для входа на сайт Memour: ${fresh.code}. Никому не сообщайте код.`

  if (import.meta.dev) console.info(`[phone-otp] dev code for ${maskPhone(phone)}: ${fresh.code}`)

  const send = await sendSms(phone, message)
  if (!send.ok) {
    console.error(`[phone-otp] SMS to ${maskPhone(phone)} failed:`, send.error)
    if (!import.meta.dev) {
      // The code never arrived — drop it (the previous code, if any,
      // stays valid) so an immediate retry isn't blocked by the 30 s window.
      await deleteOtp(admin, 'phone_otps', 'phone', phone, fresh.code_hash).catch(() => {})
      fail(502, 'sms_send_failed')
    }
  }

  // Delivered: from now on only the new code counts.
  await closeOpenOtps(admin, 'phone_otps', 'phone', phone, fresh.created_at).catch((e) =>
    console.error('[phone-otp] closing older codes failed', e),
  )

  return { ok: true, expires_in: CODE_TTL_MS / 1000 }
})
