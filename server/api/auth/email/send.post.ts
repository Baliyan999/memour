import { z } from 'zod'
import { serverSupabaseClient } from '#supabase/server'
import { checkRateLimit, getTrustedClientIp } from '../../../utils/rate-limit'
import { consentField, recordConsent, requireConsent } from '../../../utils/consent'
import { fail, failZod } from '../../../utils/errors'

/**
 * POST /api/auth/email/send — the couple's email login link.
 *
 *   Body: { email, locale?, consent }
 *
 * The browser used to call supabase.auth.signInWithOtp itself; it goes
 * through here now so the link is sent only after the couple has ticked
 * the terms and the privacy policy, and that is recorded
 * (consent_events, subject = the address; the auth account is the one
 * with that email).
 *
 * serverSupabaseClient(event) is the anon client bound to this
 * request's cookies: GoTrue's PKCE verifier is set on this response,
 * so the link logs the couple in in the browser that asked for it.
 * The link comes back as /{locale}/dashboard?code=…, which
 * server/middleware/auth-code.ts swaps for a session (and confirms
 * this consent with the account id) before the page renders.
 *
 * Errors: invalid_email, email_resend_wait {sec}, email_rate_limited,
 * email_send_failed, consent_required, consent_outdated.
 */
const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.enum(['uz', 'ru']).optional(),
  consent: consentField,
})

// GoTrue has its own limits; this one stops a script before it reaches them.
const IP_LIMIT = 5
const IP_WINDOW_MS = 10 * 60_000

export default defineEventHandler(async (event) => {
  if (!checkRateLimit('email-link-ip', getTrustedClientIp(event), IP_LIMIT, IP_WINDOW_MS)) {
    fail(429, 'email_rate_limited')
  }

  const body = await readBody(event).catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) failZod(parsed.error, { email: 'invalid_email', consent: 'consent_required' }, 'invalid_email')
  const { email } = parsed.data
  const locale = parsed.data.locale ?? 'uz'
  const consentDocs = requireConsent('login', parsed.data.consent)

  await recordConsent(event, {
    context: 'login',
    subject: { type: 'couple', email },
    docs: consentDocs,
    locale,
    extra: { channel: 'email' },
  })

  const site = useRuntimeConfig().public.siteUrl.replace(/\/+$/, '')
  const supabase = await serverSupabaseClient(event)
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${site}/${locale}/dashboard` },
  })
  if (error) {
    const status = Number((error as { status?: number }).status ?? 0)
    const code = (error as { code?: string }).code
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
      // GoTrue's per-address throttle names its wait ("…after 42 seconds");
      // that number is the only thing taken from its English text.
      const sec = Number(/(\d+)\s*seconds?/i.exec(error.message ?? '')?.[1])
      if (sec > 0) fail(429, 'email_resend_wait', { params: { sec } })
      fail(429, 'email_rate_limited')
    }
    if (code === 'email_address_invalid' || code === 'validation_failed') fail(422, 'invalid_email')
    console.error('[auth/email] signInWithOtp failed', status, code)
    fail(502, 'email_send_failed')
  }
  return { ok: true }
})
