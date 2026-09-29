import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hashCode, maskPhone, normalizePhone } from '../../../utils/phone-otp'
import { OTP_MAX_ATTEMPTS, consumeOtp, otpHashMatches, spendOtpAttempt } from '../../../utils/otp-store'
import { checkRateLimit, getTrustedClientIp } from '../../../utils/rate-limit'
import { fail } from '../../../utils/errors'
import { consentField, recordConsent, requireConsent } from '../../../utils/consent'

/**
 * POST /api/auth/phone/verify — finalize a phone login.
 *
 *   1. Spend one attempt on the newest open code for the phone, then
 *      compare (constant time). Five checks per code, right or wrong;
 *      after that the couple has to request a new code.
 *   2. Mark the OTP consumed (one-shot use).
 *   3. Generate a one-time magic link via admin.generateLink for the
 *      synthetic email "phone+998XXXXXXXXX@phone.memour.local" and
 *      return its `action_link`. GoTrue creates the user on the first
 *      login (with our user_metadata) and returns it either way, so no
 *      user lookup is needed. The client navigates to the link;
 *      Supabase sets the auth cookies and drops the couple into
 *      /dashboard with a real session (sessions, JWTs and RLS
 *      auth.uid() work exactly like email auth).
 *
 * The login is also the couple's acceptance of the terms and consent
 * to the privacy policy: the same `consent` the code request carried is
 * checked again and written to consent_events with the account id and
 * method 'checkbox+otp' (the code proves the number is theirs).
 *
 * All thrown errors carry a stable `data.code` field; the client maps
 * it to a localized message in ru/uz. We never leak raw English
 * statusMessages back to the user.
 */
const schema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().regex(/^\d{4,8}$/, 'code must be digits'),
  // Locale the user is currently viewing — passed so the magic-link
  // redirect lands them back on the same language they started in
  // instead of always bouncing to the default locale.
  locale: z.enum(['ru', 'uz']).optional(),
  consent: consentField,
})

// A person types a code a few times; a script tries thousands.
const IP_VERIFY_MAX = 30
const IP_VERIFY_WINDOW_MS = 10 * 60 * 1000

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  if (!checkRateLimit('otp-verify-ip', getTrustedClientIp(event), IP_VERIFY_MAX, IP_VERIFY_WINDOW_MS)) {
    fail(429, 'rate_limited')
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) fail(422, 'invalid_phone')

  const consentDocs = requireConsent('login', parsed.data.consent)

  const admin = serverSupabaseServiceRole<Database>(event)

  const attempt = await spendOtpAttempt(admin, 'phone_otps', 'phone', phone).catch((e) => {
    console.error('[phone-otp] attempt lookup failed', e)
    fail(500, 'storage_error')
  })
  if (attempt.status === 'none') fail(410, 'code_expired')
  if (attempt.status === 'locked') fail(429, 'too_many_attempts')
  if (attempt.status === 'busy') fail(429, 'rate_limited')

  if (!otpHashMatches(hashCode(phone, parsed.data.code), attempt.codeHash)) {
    if (attempt.attempts >= OTP_MAX_ATTEMPTS) fail(429, 'too_many_attempts')
    fail(401, 'invalid_code')
  }

  // One-shot: mark consumed. Losing this race means a parallel request
  // with the same code already logged in.
  if (!(await consumeOtp(admin, 'phone_otps', 'phone', phone, attempt.codeHash))) {
    fail(410, 'code_expired')
  }

  // Synthetic email for the Supabase user — keeps existing email-auth
  // plumbing (sessions, JWTs, RLS auth.uid()) working unchanged.
  // E.g. "phone+998901234567@phone.memour.local"
  const syntheticEmail = `phone${phone}@phone.memour.local`

  // Generate a one-time magic link the client will navigate to.
  // Honor the caller's current locale so a Russian-speaking user
  // doesn't get bounced into the Uzbek dashboard after sign-in.
  const config = useRuntimeConfig()
  const locale = parsed.data.locale ?? 'uz'
  const redirectTo = `${config.public.siteUrl.replace(/\/+$/, '')}/${locale}/dashboard`
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: syntheticEmail,
    // Applied only when GoTrue creates the user (first login).
    options: { redirectTo, data: { phone, channel: 'phone-otp' } },
  })
  const userId = link?.user?.id
  if (linkErr || !link?.properties?.action_link || !userId) {
    console.error(`[phone-otp] generateLink for ${maskPhone(phone)} failed`, linkErr)
    fail(500, 'link_failed')
  }

  await recordConsent(event, {
    context: 'login',
    subject: { type: 'couple', userId, phone },
    docs: consentDocs,
    locale,
    method: 'checkbox+otp',
    extra: { channel: 'phone' },
  })

  // Auto-claim: link any events that were pre-created by the admin
  // for this phone (events.owner_phone = phone) to the user_id.
  try {
    await (admin as any)
      .from('events')
      .update({ owner_id: userId })
      .eq('owner_phone', phone)
      .is('owner_id', null)
  } catch (e) {
    console.warn('[phone-otp] event claim failed', e)
  }

  return {
    ok: true,
    user_id: userId,
    action_link: link!.properties!.action_link,
  }
})
