import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendSms } from '../../utils/eskiz'

/**
 * POST /api/admin/events — admin creates an event for a couple.
 *
 * Flow:
 *   1. Verify the caller is logged in AND is in the `admins` table.
 *   2. If `owner_email` provided, look up (or invite + create) the
 *      corresponding auth user via the service-role admin client and
 *      send them a magic link they can use to access their dashboard.
 *   3. Insert the event row with the resolved owner_id.
 *   4. Optionally insert empty branding row (we do this so the
 *      couple's branding settings page has something to load).
 */
const bodySchema = z.object({
  couple_names: z.string().min(2).max(120),
  wedding_date: z.string().date(),
  venue_name: z.string().max(160).optional().nullable(),
  venue_lat: z.number().optional().nullable(),
  venue_lng: z.number().optional().nullable(),
  geofence_radius: z.number().int().min(20).max(2000).default(120),
  table_count: z.number().int().min(1).max(200).default(10),
  plan_tier: z.enum(['basic', 'pro', 'premium', 'luxury']).default('basic'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  owner_email: z.string().email().optional().nullable(),
  // Primary couple-link channel in UZ market: phone in +998 form.
  // When the couple later logs in via phone OTP, the verify endpoint
  // auto-claims this event by matching owner_phone.
  owner_phone: z.string().regex(/^\+998\d{9}$/).optional().nullable(),
})

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })

  const admin = serverSupabaseServiceRole<Database>(event)

  // Verify admin status server-side.
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!adminRow) {
    throw createError({ statusCode: 403, statusMessage: 'Not an admin' })
  }

  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 422,
      statusMessage: parsed.error.issues[0]?.message ?? 'invalid input',
    })
  }
  const input = parsed.data

  // Resolve owner_id from email — create auth user if needed.
  let ownerId: string | null = null
  if (input.owner_email) {
    const { data: existing } = await admin.auth.admin.listUsers()
    const found = existing?.users.find((u) => u.email === input.owner_email)
    if (found) {
      ownerId = found.id
    } else {
      // Invite new user; they get a magic link by email.
      const config = useRuntimeConfig()
      const { data: invited, error: inviteErr } =
        await admin.auth.admin.inviteUserByEmail(input.owner_email, {
          redirectTo: `${config.public.siteUrl}/dashboard`,
        })
      if (inviteErr) {
        throw createError({ statusCode: 500, statusMessage: inviteErr.message })
      }
      ownerId = invited.user.id
    }
  }

  const { data: created, error: insertErr } = await admin
    .from('events')
    .insert({
      couple_names: input.couple_names,
      wedding_date: input.wedding_date,
      venue_name: input.venue_name ?? null,
      venue_lat: input.venue_lat ?? null,
      venue_lng: input.venue_lng ?? null,
      geofence_radius: input.geofence_radius,
      table_count: input.table_count,
      plan_tier: input.plan_tier,
      status: input.status,
      owner_id: ownerId,
      // Stored even when ownerId is null — lets the future phone-OTP
      // login auto-claim the event without admin intervention.
      ...(input.owner_phone ? { owner_phone: input.owner_phone } : {}),
    } as any)
    .select()
    .single()
  if (insertErr || !created) {
    throw createError({ statusCode: 500, statusMessage: insertErr?.message ?? 'insert failed' })
  }

  // Seed an empty branding row so the couple's settings page has
  // something to upsert against later.
  await admin.from('branding').insert({ event_id: created.id })

  // Notify the couple by SMS — they may not know admin created the
  // event yet. Eskiz test-mode template is fine: it tells them to
  // expect a login code soon. (After contract approval we can swap
  // for a real "your event is ready" template.)
  if (input.owner_phone) {
    const config = useRuntimeConfig()
    const loginUrl = `${config.public.siteUrl}/uz/dashboard/login`
    const useTest = process.env.ESKIZ_USE_TEST_TEMPLATE !== 'false'
    const message = useTest
      ? 'Bu Eskiz dan test'
      : `Memour: для вашей свадьбы открыт кабинет. Войти: ${loginUrl}`
    await sendSms(input.owner_phone, message).catch((e) =>
      console.error('[admin/events] notify couple failed', e),
    )
  }

  return { ok: true, event: created }
})
