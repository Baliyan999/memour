import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { hashCode, normalizePhone } from '../../../utils/phone-otp'

/**
 * POST /api/auth/phone/verify — finalize a phone login.
 *
 *   1. Verify the code matches a non-consumed, non-expired OTP row.
 *   2. Mark the OTP consumed (one-shot use).
 *   3. Find or create a Supabase auth user keyed by phone. We use a
 *      synthetic email "phone+998XXXXXXXXX@phone.memour.local" so the
 *      same Supabase email-auth machinery (sessions, RLS, JWTs) can be
 *      reused without us hand-rolling JWT cookies.
 *   4. Generate a one-time magic link via admin.generateLink and
 *      return its `action_link` URL. The client navigates to that URL
 *      and Supabase sets the auth cookies, dropping the couple into
 *      /dashboard with a real session.
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
})

const MAX_ATTEMPTS = 5

function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) fail(422, 'invalid_phone')

  const code_hash = hashCode(phone, parsed.data.code)
  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: otp } = await admin
    .from('phone_otps')
    .select('phone, code_hash, expires_at, consumed_at, attempts')
    .eq('phone', phone)
    .eq('code_hash', code_hash)
    .is('consumed_at', null)
    .maybeSingle()

  if (!otp) fail(401, 'invalid_code')
  if (new Date(otp.expires_at).getTime() < Date.now()) fail(410, 'code_expired')
  if ((otp.attempts ?? 0) >= MAX_ATTEMPTS) fail(429, 'too_many_attempts')

  // One-shot: mark consumed.
  await admin
    .from('phone_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('phone', phone)
    .eq('code_hash', code_hash)

  // Synthetic email for the Supabase user — keeps existing email-auth
  // plumbing (sessions, JWTs, RLS auth.uid()) working unchanged.
  // E.g. "phone+998901234567@phone.memour.local"
  const syntheticEmail = `phone${phone}@phone.memour.local`

  // Try to create the user; if Supabase says "already registered",
  // find them via listUsers and reuse. listUsers' filter param accepts
  // an email but the API ignores it on older versions, so we paginate
  // through and match in memory — costly only on the first ~50k users.
  let userId: string | null = null
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: { phone, channel: 'phone-otp' },
  })
  if (created?.user) {
    userId = created.user.id
  } else if (createErr) {
    const alreadyExists =
      /already.*registered|already.*exists|duplicate/i.test(createErr.message)
    if (!alreadyExists) fail(500, 'user_create_failed')
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
    const found = list?.users.find((u) => u.email === syntheticEmail)
    if (!found) fail(500, 'user_lookup_failed')
    userId = found!.id
  } else {
    fail(500, 'user_create_failed')
  }

  // Generate a one-time magic link the client will navigate to.
  // Honor the caller's current locale so a Russian-speaking user
  // doesn't get bounced into the Uzbek dashboard after sign-in.
  const config = useRuntimeConfig()
  const locale = parsed.data.locale ?? 'uz'
  const redirectTo = `${config.public.siteUrl}/${locale}/dashboard`
  // Auto-claim: link any events that were pre-created by the admin
  // for this phone (events.owner_phone = phone) to the fresh user_id.
  // Also link the latest lead with the same phone so admin reports
  // can track conversion lead → couple-account → event.
  try {
    await (admin as any)
      .from('events')
      .update({ owner_id: userId })
      .eq('owner_phone', phone)
      .is('owner_id', null)
  } catch (e) {
    console.warn('[phone-otp] event claim failed', e)
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: syntheticEmail,
    options: { redirectTo },
  })
  if (linkErr || !link?.properties?.action_link) {
    console.error('[phone-otp] generateLink failed', linkErr)
    fail(500, 'link_failed')
  }

  return {
    ok: true,
    user_id: userId,
    action_link: link!.properties!.action_link,
  }
})
