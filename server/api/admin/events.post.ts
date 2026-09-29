import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { sendSms } from '../../utils/eskiz'
import { findAuthUserByEmail, isPhoneAccount } from '../../utils/auth-users'
import { recordManualPayment } from '../../utils/manual-payment'
import { fail, failZod } from '../../utils/errors'

/**
 * POST /api/admin/events — admin creates an event for a couple.
 *
 * Flow:
 *   1. Verify the caller is logged in AND is in the `admins` table.
 *   2. Decide who owns the event. An event has ONE owner account, and
 *      SMS login and email login produce different accounts, so the
 *      couple gets exactly one channel:
 *        - owner_phone (the primary channel in UZ) → owner_id stays
 *          null; the couple's first SMS login auto-claims the event by
 *          matching owner_phone. Any email in the body is ignored —
 *          pre-assigning the event to an email account is what used to
 *          leave SMS-logged-in couples with an empty dashboard.
 *        - owner_email only (no Uzbek number) → find the account by
 *          email, or create a confirmed one. No email is sent here,
 *          so creating an event never depends on SMTP; the couple
 *          signs in from /dashboard/login with that address. A team
 *          member's account is refused (422 admin_account): the event
 *          would land in the admin's own dashboard.
 *   3. Insert the event row. Created straight as active = paid
 *      offline, so a 'manual' payment is recorded with it.
 *   4. Seed an empty branding row (so the couple's branding settings
 *      page has something to load).
 *   5. If created from a lead (`lead_id`): mark the lead won + linked,
 *      and credit the lead's referral partner with this event.
 *   6. Notify the couple by SMS (phone channel only). `notified`:
 *      true / false (Eskiz accepted / refused), 'skipped' (Eskiz test
 *      mode — nothing sent, the admin should tell the couple), null
 *      (email channel, nothing to send).
 */
const bodySchema = z.object({
  couple_names: z.string().trim().min(2).max(120),
  wedding_date: z.string().date(),
  venue_name: z.string().max(160).optional().nullable(),
  venue_lat: z.number().optional().nullable(),
  venue_lng: z.number().optional().nullable(),
  geofence_radius: z.number().int().min(20).max(2000).default(120),
  table_count: z.number().int().min(1).max(200).default(10),
  plan_tier: z.enum(['basic', 'pro', 'premium', 'luxury']).default('basic'),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  owner_email: z.string().trim().email().max(160).optional().nullable(),
  owner_phone: z.string().regex(/^\+998\d{9}$/).optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
})

// First invalid field → a code the admin UI can show next to the form.
const FIELD_CODES = {
  couple_names: 'invalid_names',
  wedding_date: 'invalid_date',
  table_count: 'invalid_table_count',
  owner_phone: 'invalid_phone',
  owner_email: 'invalid_email',
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)

  // Verify admin status server-side.
  const adminId: string = (user as any).id ?? (user as any).sub
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', adminId)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const body = await readBody(event)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) failZod(parsed.error, FIELD_CODES)
  const input = parsed.data

  // Email-only couples: resolve (or create) the owner account up front,
  // so a failure here leaves nothing half-created.
  let ownerId: string | null = null
  if (!input.owner_phone && input.owner_email) {
    const email = input.owner_email.toLowerCase()
    if (isPhoneAccount({ email })) fail(422, 'invalid_email')
    let teamAccount = false
    try {
      const found = await findAuthUserByEmail(admin, email)
      if (found) {
        const { data: isAdmin, error: adminErr } = await admin
          .from('admins').select('user_id').eq('user_id', found.id).maybeSingle()
        if (adminErr) throw adminErr
        teamAccount = !!isAdmin
        ownerId = found.id
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        })
        if (createErr || !created.user) throw createErr ?? new Error('no user')
        ownerId = created.user.id
      }
    } catch (e) {
      console.error('[admin/events] owner account', e)
      fail(500, 'owner_create_failed')
    }
    if (teamAccount) fail(422, 'admin_account')
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
      // Phone login auto-claims events whose owner_id is still null.
      owner_phone: input.owner_phone ?? null,
    })
    .select()
    .single()
  if (insertErr || !created) {
    console.error('[admin/events] insert', insertErr)
    fail(500, 'insert_failed')
  }

  // Seed an empty branding row so the couple's settings page has
  // something to upsert against later.
  await admin.from('branding').insert({ event_id: created.id })

  if (created.status === 'active') {
    try {
      await recordManualPayment(admin, created, adminId)
    } catch (e) {
      // The event is live either way; only the referral report misses it.
      console.error('[admin/events] manual payment', e)
    }
  }

  // Lead → event conversion. Done here rather than by a follow-up
  // call from the browser, so the partner's credit can't get lost.
  let leadLocale: string | null = null
  if (input.lead_id) {
    const { data: lead } = await admin
      .from('leads')
      .update({ status: 'won', converted_event_id: created.id })
      .eq('id', input.lead_id)
      .select('id, locale')
      .maybeSingle()
    if (lead) {
      leadLocale = lead.locale
      const { error: attrErr } = await admin
        .from('referral_attributions')
        .update({ event_id: created.id })
        .eq('lead_id', lead.id)
      if (attrErr) console.error('[admin/events] referral attribution', attrErr)
    }
  }

  // Notify the couple by SMS — they may not know admin created the
  // event yet. Not in Eskiz test mode: there the only allowed text is
  // "Bu Eskiz dan test", which means nothing to a real couple. The
  // text has to be an approved Eskiz template in each language.
  // Test mode is opt-in, exactly like the login SMS (auth/phone/send).
  let notified: boolean | 'skipped' | null = null
  const smsTestMode = process.env.ESKIZ_USE_TEST_TEMPLATE === 'true'
  if (input.owner_phone && smsTestMode) {
    notified = 'skipped'
  } else if (input.owner_phone) {
    const locale = leadLocale === 'ru' ? 'ru' : 'uz'
    const siteUrl = useRuntimeConfig().public.siteUrl.replace(/\/+$/, '')
    const loginUrl = `${siteUrl}/${locale}/dashboard/login`
    // Plain ASCII apostrophes on purpose: they keep the Uzbek SMS in
    // the GSM-7 alphabet (160 chars a part instead of 70).
    const message = locale === 'ru'
      ? `Memour: для вашей свадьбы открыт кабинет. Войти: ${loginUrl}`
      : `Memour: to'yingiz uchun kabinet ochildi. Kirish: ${loginUrl}`
    try {
      const res = await sendSms(input.owner_phone, message)
      notified = res.ok
      if (!res.ok) console.error('[admin/events] notify couple rejected', res.error)
    } catch (e) {
      notified = false
      console.error('[admin/events] notify couple failed', e)
    }
  }

  return { ok: true, event: created, notified }
})
