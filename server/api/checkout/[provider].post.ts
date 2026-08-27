import type { Database } from '~/types/database.types'
import { z } from 'zod'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'
import { getTierPriceTiyin } from '../../utils/pricing'

/**
 * POST /api/checkout/[provider] — initiate a payment for an event.
 *
 *   Body: { event_id }
 *   Returns: { url, payment_id }
 *
 * The URL is the provider's hosted checkout page; we redirect the
 * couple there. The provider then calls back to our webhook
 * (/api/payments/[provider]/webhook) when payment completes, at
 * which point we flip the event to `active`.
 *
 * Supported providers (skeleton — real merchant credentials needed
 * once the legal entity + merchant account is set up):
 *   - payme  →  https://checkout.paycom.uz
 *   - click  →  https://my.click.uz/services/pay
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const schema = z.object({ event_id: z.string().uuid() })

export default defineEventHandler(async (event) => {
  const provider = getRouterParam(event, 'provider')
  if (provider !== 'payme' && provider !== 'click') {
    fail(400, 'unsupported_provider')
  }

  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')

  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    fail(422, 'invalid_input')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, plan_tier, owner_id, status')
    .eq('id', parsed.data.event_id)
    .maybeSingle()
  if (!ev)
    fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub))
    fail(403, 'forbidden')
  if (ev!.status === 'active')
    fail(409, 'already_paid')

  const amount = getTierPriceTiyin(ev!.plan_tier ?? 'basic')

  // Persist a pending payment row so the webhook has something to
  // reconcile against by id.
  const { data: payment, error: insErr } = await admin
    .from('payments')
    .insert({
      event_id: ev!.id,
      provider: provider!,
      amount,
      currency: 'UZS',
      status: 'pending',
    } as any)
    .select('id')
    .single()
  if (insErr || !payment)
    fail(500, 'storage_error')

  const config = useRuntimeConfig()
  const returnUrl = `${config.public.siteUrl}/uz/dashboard/event/${ev!.id}`

  if (provider === 'payme') {
    const merchantId = process.env.PAYME_MERCHANT_ID
    if (!merchantId) {
      // Dev fallback: just mark the payment paid immediately so the
      // couple can test the flow end-to-end without real merchant
      // credentials. Real prod must set PAYME_MERCHANT_ID + keys.
      await markPaymentPaid(admin, payment.id, ev!.id)
      return { url: returnUrl, payment_id: payment.id, dev: true }
    }
    // Payme uses base64-encoded merchant + amount + account fields in
    // the URL fragment. See https://developer.help.paycom.uz/initsializatsiya-platezhey
    const params = [
      `m=${merchantId}`,
      `ac.event_id=${ev!.id}`,
      `ac.payment_id=${payment.id}`,
      `a=${amount}`,
      `c=${encodeURIComponent(returnUrl)}`,
    ].join(';')
    const encoded = Buffer.from(params).toString('base64')
    const url = `https://checkout.paycom.uz/${encoded}`
    return { url, payment_id: payment.id }
  }

  if (provider === 'click') {
    const serviceId = process.env.CLICK_SERVICE_ID
    const merchantId = process.env.CLICK_MERCHANT_ID
    if (!serviceId || !merchantId) {
      await markPaymentPaid(admin, payment.id, ev!.id)
      return { url: returnUrl, payment_id: payment.id, dev: true }
    }
    // Click pay URL: https://my.click.uz/services/pay?service_id=...&merchant_id=...&amount=...&transaction_param=...&return_url=...
    const amountUzs = amount / 100
    const url
      = `https://my.click.uz/services/pay?`
        + `service_id=${serviceId}`
        + `&merchant_id=${merchantId}`
        + `&amount=${amountUzs}`
        + `&transaction_param=${payment.id}`
        + `&return_url=${encodeURIComponent(returnUrl)}`
    return { url, payment_id: payment.id }
  }

  fail(400, 'unsupported_provider')
})

async function markPaymentPaid(admin: any, paymentId: string, eventId: string) {
  await admin
    .from('payments')
    .update({ status: 'paid' })
    .eq('id', paymentId)
  await admin
    .from('events')
    .update({ status: 'active' })
    .eq('id', eventId)
}
