import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * POST /api/payments/click/webhook — Click Pay merchant API endpoint.
 *
 * Click sends two requests:
 *   action=0  → PREPARE (validate & reserve)
 *   action=1  → COMPLETE (confirm payment)
 *
 * Authentication: an MD5 signature of concatenated fields with
 * CLICK_SECRET_KEY. We recompute and compare.
 *
 * Fields per Click docs:
 *   click_trans_id, service_id, click_paydoc_id, merchant_trans_id
 *   (= our payment.id), amount, action, sign_time, sign_string,
 *   error, error_note, merchant_prepare_id (action=1 only)
 */

interface ClickPayload {
  click_trans_id: string
  service_id: string
  click_paydoc_id: string
  merchant_trans_id: string  // our payment.id
  amount: string             // sums (not tiyin) — Click is special
  action: string             // '0' or '1'
  sign_time: string
  sign_string: string
  error?: string
  error_note?: string
  merchant_prepare_id?: string
}

function clickResponse(
  click_trans_id: string,
  merchant_trans_id: string,
  merchant_prepare_id: string | null,
  error: number,
  error_note: string,
) {
  return {
    click_trans_id,
    merchant_trans_id,
    merchant_prepare_id: merchant_prepare_id ?? '',
    error,
    error_note,
  }
}

function verifySignature(p: ClickPayload): boolean {
  const secret = process.env.CLICK_SECRET_KEY
  if (!secret) return false
  // PREPARE sign string: click_trans_id+service_id+SECRET_KEY+merchant_trans_id+amount+action+sign_time
  // COMPLETE adds +merchant_prepare_id before sign_time
  const base =
    p.action === '0'
      ? `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.amount}${p.action}${p.sign_time}`
      : `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.merchant_prepare_id ?? ''}${p.amount}${p.action}${p.sign_time}`
  const expected = createHash('md5').update(base).digest('hex')
  return expected === p.sign_string
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const p = body as ClickPayload

  if (!verifySignature(p)) {
    return clickResponse(p.click_trans_id, p.merchant_trans_id, null, -1, 'SIGN CHECK FAILED!')
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: payment } = await admin
    .from('payments')
    .select('id, status, amount, event_id, metadata')
    .eq('id', p.merchant_trans_id)
    .maybeSingle()

  if (!payment) {
    return clickResponse(p.click_trans_id, p.merchant_trans_id, null, -5, 'Order not found')
  }

  const expectedAmountSums = payment.amount / 100  // tiyin → sums
  if (Number(p.amount) !== expectedAmountSums) {
    return clickResponse(p.click_trans_id, p.merchant_trans_id, null, -2, 'Wrong amount')
  }

  if (p.action === '0') {
    // PREPARE — return a merchant_prepare_id (we use payment.id)
    if (payment.status === 'paid') {
      return clickResponse(p.click_trans_id, p.merchant_trans_id, payment.id, -4, 'Already paid')
    }
    return clickResponse(p.click_trans_id, p.merchant_trans_id, payment.id, 0, 'Success')
  }

  if (p.action === '1') {
    // COMPLETE
    if (payment.status === 'paid') {
      return clickResponse(p.click_trans_id, p.merchant_trans_id, payment.id, 0, 'Already paid')
    }
    if (p.error && Number(p.error) < 0) {
      await admin
        .from('payments')
        .update({ status: 'failed', metadata: { ...(payment.metadata as any || {}), click_error: p.error_note } } as any)
        .eq('id', payment.id)
      return clickResponse(p.click_trans_id, p.merchant_trans_id, payment.id, Number(p.error), p.error_note ?? 'failed')
    }
    await admin
      .from('payments')
      .update({
        status: 'paid',
        provider_transaction_id: p.click_trans_id,
        metadata: { ...(payment.metadata as any || {}), click_paydoc_id: p.click_paydoc_id },
      } as any)
      .eq('id', payment.id)
    await admin
      .from('events')
      .update({ status: 'active' })
      .eq('id', payment.event_id)
    return clickResponse(p.click_trans_id, p.merchant_trans_id, payment.id, 0, 'Success')
  }

  return clickResponse(p.click_trans_id, p.merchant_trans_id, null, -3, 'Unknown action')
})
