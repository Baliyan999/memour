import type { Database } from '~/types/database.types'
import { z } from 'zod'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

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
 * If a Supabase auth user already exists for the email (e.g. they
 * were a couple before), we just update their password and admin
 * privileges. Otherwise we create a new auth user with the provided
 * password.
 *
 * Role is hardcoded 'admin' — only the schema migration can mint a
 * super-admin, by design (avoids accidentally granting irrevocable
 * power through the UI).
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(6).max(200),
  telegram_chat_id: z.string().regex(/^\d{5,15}$/, 'numeric chat id'),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: me } = await admin
    .from('admins')
    .select('user_id, role')
    .eq('user_id', uid)
    .maybeSingle()
  if (!me)
    fail(403, 'forbidden')
  if ((me as any).role !== 'super')
    fail(403, 'not_super')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    fail(422, 'invalid_input')

  const email = parsed.data.email.trim().toLowerCase()

  // Find or create the auth user.
  let inviteeId: string | null = null
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
  const found = list?.users.find(u => u.email?.toLowerCase() === email)
  if (found) {
    inviteeId = found.id
    // Update password so they can log in with the provided one.
    const { error: pwErr } = await admin.auth.admin.updateUserById(found.id, {
      password: parsed.data.password,
      email_confirm: true,
    })
    if (pwErr) {
      console.error('[admin/admins] update password', pwErr)
      fail(500, 'update_failed')
    }
  }
  else {
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

  // Upsert into admins with role='admin' (never super via UI) + chat_id.
  const { error: upErr } = await admin
    .from('admins')
    .upsert(
      {
        user_id: inviteeId!,
        role: 'admin',
        telegram_chat_id: parsed.data.telegram_chat_id,
      } as any,
      { onConflict: 'user_id' },
    )
  if (upErr) {
    console.error('[admin/admins] upsert', upErr)
    fail(500, 'storage_error')
  }

  return { ok: true, user_id: inviteeId }
})
