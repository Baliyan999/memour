import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { findAuthUserByEmail, isPhoneAccount } from '../../../utils/auth-users'
import { fail, failZod } from '../../../utils/errors'

/**
 * POST /api/admin/admins — super-admin adds a teammate.
 *
 *   Body: { email, password, telegram_chat_id }
 *
 * No invitation emails — the super-admin sets the new admin's
 * password and Telegram chat ID themselves and shares them with the
 * teammate out-of-band (in person / chat). The teammate then logs in
 * at /admin/login with that password and receives the 6-digit code
 * in their Telegram.
 *
 * Existing accounts are never modified:
 *   - already an admin → 409 already_admin (role, password and chat
 *     ID stay as they are — re-adding yourself used to demote a super
 *     admin and reset their password);
 *   - an SMS-login couple account (phone+…@phone.memour.local) →
 *     422 phone_account;
 *   - any other existing account (e.g. a removed admin coming back)
 *     gets the admin role but keeps its own password — the response
 *     says so with `existing_account: true`. Setting someone's
 *     password here would let an admin take over a couple's account.
 *
 * Role is hardcoded 'admin' — only the schema migration can mint a
 * super-admin, by design (avoids accidentally granting irrevocable
 * power through the UI).
 */
// Admins are the only password users, and the password is their only
// factor against Supabase's /token endpoint (GoTrue's minimum should
// be 12 too). admin-auth/login keeps min(6): existing admins with a
// shorter password must still be able to sign in.
const MIN_PASSWORD = 12

const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(MIN_PASSWORD).max(200),
  telegram_chat_id: z.string().regex(/^\d{5,15}$/),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: me } = await admin
    .from('admins')
    .select('user_id, role')
    .eq('user_id', uid)
    .maybeSingle()
  if (!me) fail(403, 'forbidden')
  if ((me as any).role !== 'super') fail(403, 'not_super')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    failZod(parsed.error, {
      email: 'invalid_email',
      password: { too_small: 'password_too_short' },
      telegram_chat_id: 'invalid_chat_id',
    })
  }

  const email = parsed.data.email.trim().toLowerCase()
  if (isPhoneAccount({ email })) fail(422, 'phone_account')

  let found: Awaited<ReturnType<typeof findAuthUserByEmail>> = null
  try {
    found = await findAuthUserByEmail(admin, email)
  } catch (e) {
    console.error('[admin/admins] lookup', e)
    fail(500, 'lookup_failed')
  }

  let inviteeId: string
  if (found) {
    if (isPhoneAccount(found)) fail(422, 'phone_account')
    const { data: existingRow } = await admin
      .from('admins').select('user_id').eq('user_id', found.id).maybeSingle()
    if (existingRow) fail(409, 'already_admin')
    inviteeId = found.id
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: parsed.data.password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      console.error('[admin/admins] create user', createErr)
      fail(500, 'create_failed')
    }
    inviteeId = created.user.id
  }

  // Plain insert (never upsert): an existing row is handled above, so
  // this can't overwrite anyone's role.
  const { error: insErr } = await admin
    .from('admins')
    .insert({
      user_id: inviteeId,
      role: 'admin',
      telegram_chat_id: parsed.data.telegram_chat_id,
    } as any)
  if (insErr) {
    console.error('[admin/admins] insert', insErr)
    if ((insErr as any).code === '23505') fail(409, 'already_admin')
    fail(500, 'storage_error')
  }

  return { ok: true, user_id: inviteeId, existing_account: !!found }
})
