import { z } from 'zod'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getTierPriceTiyin } from '../../utils/pricing'
import {
  PAYMENT_COLUMNS,
  activateEvent,
  casPayment,
  countsAsPaid,
  paymentsDevMode,
  providerConfigured,
  reservationEnd,
  type Admin,
  type PaymentRow,
} from '../../utils/payments'
import { fail } from '../../utils/errors'
import { consentField, recordConsent, requireConsent } from '../../utils/consent'

/**
 * POST /api/checkout/[provider] — initiate a payment for an event.
 *
 *   Body: { event_id, locale?, consent, deletion_date }
 *   Returns: { url, payment_id }
 *
 * `consent` is the couple's acceptance of the public offer (of the
 * terms, whose interim edition carries the refund rules, while no offer
 * is published — shared/legal.ts). Without it: 422 consent_required.
 * The same box says on which date the files are deleted for good and
 * that the couple downloads the archive before it; `deletion_date` is
 * the event's archive_expires_at the page showed there. If it is not
 * the current one (the wedding date or tier changed meanwhile): 409
 * deletion_date_changed. It is recorded in consent_events with the payment
 * id, tier, amount and that date (extra.deletion_date) before the
 * couple leaves for the payment page.
 *
 * The URL is the provider's hosted checkout page; we redirect the
 * couple there. The provider then calls back to our webhook
 * (/api/payments/[provider]/webhook) when payment completes, at
 * which point we flip the event to `active`.
 *
 * Supported providers:
 *   - payme  →  https://checkout.paycom.uz   (PAYME_MERCHANT_ID + PAYME_MERCHANT_KEY)
 *   - click  →  https://my.click.uz/services/pay   (CLICK_SERVICE_ID + CLICK_MERCHANT_ID + CLICK_SECRET_KEY)
 *
 * A provider without its full set of keys is closed: 503
 * `payments_unavailable`. The only exception is local development with
 * PAYMENTS_DEV_MODE=true, where the payment is marked paid on the spot.
 */
const schema = z.object({
  event_id: z.string().uuid(),
  locale: z.enum(['uz', 'ru']).optional(),
  consent: consentField,
  deletion_date: z.string().max(40).nullable().optional(),
})

export default defineEventHandler(async (event) => {
  const provider = getRouterParam(event, 'provider')
  if (provider !== 'payme' && provider !== 'click') {
    fail(400, 'unsupported_provider')
  }

  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) fail(422, 'invalid_input')
  const consentDocs = requireConsent('checkout', parsed.data.consent)

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev, error: evErr } = await admin
    .from('events')
    .select('id, couple_names, plan_tier, owner_id, status, archive_expires_at')
    .eq('id', parsed.data.event_id)
    .maybeSingle()
  if (evErr) fail(500, 'storage_error')
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')
  if (ev!.status === 'active') fail(409, 'already_paid')
  if (ev!.status !== 'draft') fail(409, 'event_archived')

  // The couple agreed to this deletion date, not to whatever it is now.
  const shownDeletion = parsed.data.deletion_date ? Date.parse(parsed.data.deletion_date) : null
  const deletion = ev!.archive_expires_at ? Date.parse(ev!.archive_expires_at) : null
  if (shownDeletion !== deletion) fail(409, 'deletion_date_changed')

  const amount = getTierPriceTiyin(ev!.plan_tier)
  if (amount === null) fail(422, 'invalid_plan')

  const devMode = paymentsDevMode()
  if (!devMode && !providerConfigured(provider!)) fail(503, 'payments_unavailable')

  const { data: existing, error: exErr } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('event_id', ev!.id)
    .in('status', ['paid', 'pending'])
    .order('created_at', { ascending: false })
  if (exErr) fail(500, 'storage_error')

  // Paid but still draft means activation failed after the money came
  // in — finish it here instead of letting the couple pay again.
  if ((existing ?? []).some(countsAsPaid)) {
    await activateEvent(admin, ev!.id)
    fail(409, 'already_paid')
  }
  // A provider is mid-way through charging an earlier attempt — a second
  // checkout now could charge the couple twice. `min`: how long until an
  // abandoned attempt stops blocking, so the text can say when to retry.
  const now = Date.now()
  const busyUntil = Math.max(0, ...(existing ?? []).map((p) => reservationEnd(p)).filter((t) => t > now))
  if (busyUntil > now) fail(409, 'payment_in_progress', { params: { min: Math.ceil((busyUntil - now) / 60_000) } })

  // Reuse an untouched pending row for the same provider + price rather
  // than piling up a new one on every click.
  let payment: Pick<PaymentRow, 'id' | 'updated_at'> | undefined = (existing ?? []).find(
    (p) => p.status === 'pending' && p.provider === provider && p.amount === amount && !p.provider_transaction_id,
  )
  if (!payment) {
    const { data: inserted, error: insErr } = await admin
      .from('payments')
      .insert({
        event_id: ev!.id,
        provider: provider!,
        amount: amount!,
        currency: 'UZS',
        status: 'pending',
      })
      .select('id, updated_at')
      .single()
    if (insErr || !inserted) fail(500, 'storage_error')
    payment = inserted!
  }

  // Send the couple back to the dashboard in the language they paid from.
  const locale = parsed.data.locale ?? (getCookie(event, 'i18n_redirected') === 'ru' ? 'ru' : 'uz')

  const u = user as { id?: string; sub?: string; email?: string; user_metadata?: { phone?: string } }
  await recordConsent(event, {
    context: 'checkout',
    subject: { type: 'couple', userId: u.id ?? u.sub ?? null, email: u.email ?? null, phone: u.user_metadata?.phone ?? null },
    docs: consentDocs,
    locale,
    paymentId: payment.id,
    extra: { event_id: ev!.id, plan: ev!.plan_tier, amount_tiyin: amount, provider, deletion_date: ev!.archive_expires_at },
  })
  const config = useRuntimeConfig()
  const returnUrl = `${config.public.siteUrl.replace(/\/+$/, '')}/${locale}/dashboard/event/${ev!.id}`

  if (devMode && !providerConfigured(provider!)) {
    await markPaidForDev(admin, payment, ev!.id)
    return { url: returnUrl, payment_id: payment.id, dev: true }
  }

  if (provider === 'payme') {
    // GET checkout: <checkout_url>/base64("k=v;k=v"). See
    // https://developer.help.paycom.uz/initsializatsiya-platezhey/otpravka-cheka-po-metodu-get
    // `c` goes in raw — Payme splits on ';' and our URL has none.
    const checkoutBase = process.env.PAYME_CHECKOUT_URL || 'https://checkout.paycom.uz'
    const params = [
      `m=${process.env.PAYME_MERCHANT_ID}`,
      `ac.event_id=${ev!.id}`,
      `ac.payment_id=${payment.id}`,
      `a=${amount}`,
      `l=${locale}`,
      `c=${returnUrl}`,
    ].join(';')
    const encoded = Buffer.from(params).toString('base64')
    return { url: `${checkoutBase}/${encoded}`, payment_id: payment.id }
  }

  // Click pay URL: https://my.click.uz/services/pay?service_id=...&merchant_id=...&amount=N.NN&transaction_param=...&return_url=...
  const amountUzs = (amount! / 100).toFixed(2)
  const url =
    `https://my.click.uz/services/pay?` +
    `service_id=${encodeURIComponent(process.env.CLICK_SERVICE_ID!)}` +
    `&merchant_id=${encodeURIComponent(process.env.CLICK_MERCHANT_ID!)}` +
    `&amount=${amountUzs}` +
    `&transaction_param=${payment.id}` +
    `&return_url=${encodeURIComponent(returnUrl)}`
  return { url, payment_id: payment.id }
})

/** Local development only (see paymentsDevMode): pretend the provider confirmed. */
async function markPaidForDev(admin: Admin, payment: Pick<PaymentRow, 'id' | 'updated_at'>, eventId: string) {
  const res = await casPayment(admin, payment, {
    status: 'paid',
    provider_transaction_id: `dev-${payment.id}`,
    metadata: { dev: true },
  })
  if (res === 'error' || res === 'conflict') fail(500, 'storage_error')
  if (!(await activateEvent(admin, eventId))) fail(500, 'storage_error')
}
