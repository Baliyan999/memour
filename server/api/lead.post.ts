import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { LEAD_LIMITS, LEAD_TIERS, REFERRAL_CODE_RE } from '#shared/lead'
import { normalizePhone } from '../utils/phone-otp'
import { checkRateLimit, getTrustedClientIp } from '../utils/rate-limit'
import { adminLink, sendTelegram, shortId } from '../utils/telegram'
import { fail, failZod } from '../utils/errors'
import { consentField, recordConsent, requireConsent } from '../utils/consent'

/**
 * POST /api/lead — landing page contact form submission. Validates,
 * inserts into the `leads` table via the service-role client (RLS is
 * on, anonymous inserts go through the privileged role on the server),
 * and pings the configured Telegram chat with the lead's short id (and
 * the tier picked on the Pricing card, if any).
 * Telegram failures are logged, never surfaced: the lead is already in
 * the DB, so the visitor's submission succeeded.
 *
 * Errors come back as stable codes in `data.code` (name_too_short,
 * invalid_phone, guests_out_of_range, …); the form turns them into
 * errors.<code> in the visitor's language.
 *
 * Consent: the form's privacy checkbox arrives as `consent: { privacy:
 * <version> }`. Without it the lead is refused (consent_required); with
 * it the consent record is written first and the lead row takes its id
 * from it, so there is never a lead without proof of consent.
 *
 * Abuse guards: a hidden honeypot field, 5 submissions per IP per 10
 * minutes, and a repeat of the same phone within 10 minutes is treated
 * as the same lead (no second row, no second Telegram ping).
 */
const RATE_LIMIT = 5
const WINDOW_MS = 10 * 60_000

// Phones whose lead is being written right now. The "same phone" check
// below can't see a row that's still being inserted, so two submits
// racing each other (double tap on a slow network) would both pass it.
const inFlight = new Set<string>()

const leadSchema = z.object({
  name: z.string().trim().min(LEAD_LIMITS.nameMin).max(LEAD_LIMITS.nameMax),
  phone: z.string().max(32),
  wedding_date: z.string().date().nullable().optional(),
  guests_estimate: z
    .number()
    .int()
    .min(LEAD_LIMITS.guestsMin)
    .max(LEAD_LIMITS.guestsMax)
    .nullable()
    .optional(),
  // Neither of these is worth losing a lead over — anything odd falls
  // back to the default instead of failing validation.
  source: z
    .string()
    .refine((s) => s === 'landing' || (s.startsWith('ref:') && REFERRAL_CODE_RE.test(s.slice(4))))
    .optional()
    .catch(undefined),
  locale: z.enum(['uz', 'ru']).optional().catch(undefined),
  // The tier whose Pricing CTA brought the visitor here.
  plan_tier: z.enum(LEAD_TIERS).optional().catch(undefined),
  // Honeypot — see LeadForm. People never see it, so they never fill it.
  hp: z.string().optional().catch(undefined),
  consent: consentField,
})

type LeadInput = z.infer<typeof leadSchema>

// Which code to answer with when a field fails validation.
const FIELD_CODES = {
  name: { too_big: 'name_too_long', '*': 'name_too_short' },
  phone: 'invalid_phone',
  wedding_date: 'invalid_date',
  guests_estimate: 'guests_out_of_range',
  consent: 'consent_required',
}

// The wedding is in the future. Two days of slack covers visitors whose
// "today" is still yesterday in UTC; five years covers the date picker.
function isPlausibleWeddingDate(iso: string): boolean {
  const day = 24 * 60 * 60 * 1000
  const min = new Date(Date.now() - 2 * day).toISOString().slice(0, 10)
  const max = new Date(Date.now() + 5 * 365 * day).toISOString().slice(0, 10)
  return iso >= min && iso <= max
}

export default defineEventHandler(async (event) => {
  if (!checkRateLimit('lead', getTrustedClientIp(event), RATE_LIMIT, WINDOW_MS)) fail(429, 'rate_limited')

  // Malformed JSON makes readBody throw with h3's English message.
  const body = await readBody(event).catch(() => null)
  if (!body || typeof body !== 'object') fail(400, 'invalid_input')
  const parsed = leadSchema.safeParse(body)
  if (!parsed.success) failZod(parsed.error, FIELD_CODES)

  // Honeypot filled → a bot. Answer like a success so it moves on.
  if (parsed.data.hp) {
    console.warn('[lead] honeypot hit, dropped')
    return { ok: true }
  }

  const phone = normalizePhone(parsed.data.phone)
  if (!phone) fail(422, 'invalid_phone')

  const weddingDate = parsed.data.wedding_date ?? null
  if (weddingDate && !isPlausibleWeddingDate(weddingDate)) fail(422, 'invalid_date')

  const consentDocs = requireConsent('lead', parsed.data.consent)

  const lead: LeadInput = { ...parsed.data, phone, wedding_date: weddingDate }
  const supabase = serverSupabaseServiceRole<Database>(event)

  // Same phone within the window: a double tap, a retry after a slow
  // network, or a spammer. The first row already reached the team.
  if (inFlight.has(phone)) return { ok: true }
  inFlight.add(phone)
  let row: { id: string }
  try {
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const { data: recent } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .gte('created_at', since)
      .limit(1)
    if (recent && recent.length > 0) return { ok: true }

    const leadId = randomUUID()
    await recordConsent(event, {
      context: 'lead',
      subject: { type: 'lead', leadId, phone },
      docs: consentDocs,
      locale: lead.locale,
      extra: { source: lead.source ?? 'landing' },
    })

    const { data, error } = await supabase
      .from('leads')
      .insert({
        id: leadId,
        name: lead.name,
        phone,
        wedding_date: weddingDate,
        guests_estimate: lead.guests_estimate ?? null,
        source: lead.source ?? 'landing',
        locale: lead.locale ?? 'uz',
        plan_tier: lead.plan_tier ?? null,
      })
      .select('id')
      .single()
    if (error || !data) {
      console.error('[lead] insert failed', error)
      fail(500, 'server_error')
    }
    row = data
  } finally {
    inFlight.delete(phone)
  }

  // Referral attribution. The lead's source field encodes "ref:CODE";
  // if a matching referral row exists, write a referral_attributions
  // record so admin reports can roll up per-partner conversions.
  const src = lead.source ?? ''
  if (src.startsWith('ref:')) {
    const code = src.slice(4).toLowerCase()
    const { data: ref } = await supabase
      .from('referrals')
      .select('id')
      .eq('code', code)
      .maybeSingle()
    if (ref) {
      await supabase
        .from('referral_attributions')
        .insert({ referral_id: ref.id, lead_id: row.id })
        .then(({ error: aErr }) => {
          if (aErr) console.error('[lead] attribution insert', aErr)
        })
    }
  }

  // Don't make the visitor wait on Telegram; the lead is saved.
  event.waitUntil(
    notifyTelegram(row.id, lead.plan_tier).catch((err) => {
      console.error('[lead] telegram notify failed', err)
    }),
  )

  return { ok: true }
})

/** "pro" → "Pro", as the Pricing cards name it. */
function tierName(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

/**
 * A neutral ping: the lead's number, the tier picked on the site (not
 * personal data) and a link to the admin list. The name, phone, date
 * and source stay in our database — Telegram keeps messages outside
 * Uzbekistan (server/utils/telegram.ts).
 */
async function notifyTelegram(leadId: string, tier?: string) {
  const title = `🎉 Новая заявка #${shortId(leadId)}${tier ? ` · ${tierName(tier)}` : ''}`
  // sendTelegram never throws and logs its own failures.
  await sendTelegram(`${title}\n${adminLink('/admin/leads')}`)
}
