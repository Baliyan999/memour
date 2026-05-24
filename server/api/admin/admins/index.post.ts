import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * POST /api/admin/admins — invite a teammate as admin.
 *
 *   Body: { email, role? = 'admin' }
 *
 * Caller must be a super-admin. If the invitee already has an auth
 * user (e.g. they once submitted the email login on /admin/login),
 * we reuse it; otherwise we invite them via Supabase auth-admin API
 * (sends a magic link to their inbox).
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({
  email: z.string().email().max(160),
  role: z.enum(['admin', 'super']).default('admin'),
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
  if (!parsed.success) fail(422, 'invalid_input')

  const config = useRuntimeConfig()
  const redirectTo = `${config.public.siteUrl}/uz/admin`

  // Find or invite the user.
  let inviteeId: string | null = null
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000, page: 1 })
  const found = existing?.users.find((u) => u.email === parsed.data.email)
  if (found) {
    inviteeId = found.id
    // Send a refresh magic link so they know they were added.
    await admin.auth.admin
      .generateLink({ type: 'magiclink', email: parsed.data.email, options: { redirectTo } })
      .catch(() => { /* ignore */ })
  } else {
    const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      { redirectTo },
    )
    if (invErr || !invited.user) fail(500, 'invite_failed')
    inviteeId = invited.user.id
  }

  // Upsert into admins.
  const { error: upErr } = await admin
    .from('admins')
    .upsert({ user_id: inviteeId!, role: parsed.data.role } as any, { onConflict: 'user_id' })
  if (upErr) fail(500, 'storage_error')

  return { ok: true, user_id: inviteeId }
})
