import { createHash } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getTierPriceTiyin } from '../../../utils/pricing'
import {
  PAYMENT_COLUMNS,
  RESERVATION_WINDOW_MS,
  UUID_RE,
  activateEvent,
  casPayment,
  otherPaymentBlocker,
  safeEqual,
  withMeta,
  type Admin,
  type PaymentRow,
} from '../../../utils/payments'

/**
 * POST /api/payments/click/webhook — Click SHOP API endpoint.
 * Spec: https://docs.click.uz/shop-api/requests (form-urlencoded in, JSON out)
 *
 * Click sends two requests:
 *   action=0  → PREPARE  (validate & reserve)  → merchant_prepare_id (int)
 *   action=1  → COMPLETE (confirm payment)     → merchant_confirm_id (int)
 *
 * Authentication: an MD5 signature of concatenated fields with
 * CLICK_SECRET_KEY. We recompute and compare.
 *
 * Fields per Click docs:
 *   click_trans_id, service_id, click_paydoc_id, merchant_trans_id
 *   (= our payment.id), amount, action, sign_time, sign_string,
 *   error, error_note, merchant_prepare_id (action=1 only)
 *
 * One payments row is one order. Prepare binds a Click transaction to
 * it (provider_transaction_id = click_trans_id, details in
 * metadata.click); complete only confirms that same transaction.
 * Repeats get the stored answer (-4 once confirmed, per spec).
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
  error: string
  error_note?: string
  merchant_prepare_id?: string
}

const REQUIRED = [
  'click_trans_id', 'service_id', 'click_paydoc_id', 'merchant_trans_id',
  'amount', 'action', 'error', 'sign_time', 'sign_string',
] as const

// error_note values are the ones the spec fixes for each code.
const NOTES: Record<number, string> = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'User does not exist',
  [-6]: 'Transaction does not exist',
  [-7]: 'Failed to update user',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
}

type Ids = { merchant_prepare_id?: number; merchant_confirm_id?: number }

function clickResponse(p: Partial<ClickPayload>, error: number, ids: Ids = {}) {
  const transId = String(p.click_trans_id ?? '')
  return {
    click_trans_id: /^\d{1,15}$/.test(transId) ? Number(transId) : (p.click_trans_id ?? null),
    merchant_trans_id: p.merchant_trans_id ?? null,
    ...ids,
    error,
    error_note: NOTES[error],
  }
}

function verifySignature(p: ClickPayload): boolean {
  const secret = process.env.CLICK_SECRET_KEY
  if (!secret) return false
  // PREPARE sign string: click_trans_id+service_id+SECRET_KEY+merchant_trans_id+amount+action+sign_time
  // COMPLETE adds +merchant_prepare_id before amount
  const base =
    p.action === '0'
      ? `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.amount}${p.action}${p.sign_time}`
      : `${p.click_trans_id}${p.service_id}${secret}${p.merchant_trans_id}${p.merchant_prepare_id ?? ''}${p.amount}${p.action}${p.sign_time}`
  const expected = createHash('md5').update(base).digest('hex')
  return safeEqual(expected, String(p.sign_string).toLowerCase())
}

/**
 * Our int id for Click (merchant_prepare_id / merchant_confirm_id).
 * Derived from the payment's uuid so no extra column is needed; it's
 * only ever checked together with merchant_trans_id, so it only has to
 * be stable per payment, not globally unique.
 */
function clickIdFor(paymentId: string): number {
  return (parseInt(paymentId.replace(/-/g, '').slice(0, 8), 16) % 2_147_483_647) + 1
}

interface ClickTx {
  click_trans_id: string
  click_paydoc_id: string
  prepare_id: number
  prepared_at: number
  completed_at?: number
  error?: number
  error_note?: string
}

const clickOf = (row: PaymentRow) => ((row.metadata as any)?.click ?? null) as ClickTx | null

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    body = null
  }
  const p = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Partial<ClickPayload>
  for (const k of REQUIRED) {
    if (p[k] === undefined || p[k] === null || p[k] === '') return clickResponse(p, -8)
  }
  const action = String(p.action)
  if (action === '1' && !p.merchant_prepare_id) return clickResponse(p, -8)

  if (!verifySignature(p as ClickPayload)) return clickResponse(p, -1)
  if (String(p.service_id) !== process.env.CLICK_SERVICE_ID) return clickResponse(p, -8)
  if (action !== '0' && action !== '1') return clickResponse(p, -3)

  const admin = serverSupabaseServiceRole<Database>(event)
  try {
    return action === '0' ? await prepare(admin, p as ClickPayload) : await complete(admin, p as ClickPayload)
  } catch (e) {
    console.error(`[click] action ${action} failed`, e)
    return clickResponse(p, -7)
  }
})

/** Finds the order and checks the amount; returns a Click error code instead when it can't. */
async function loadOrder(admin: Admin, p: ClickPayload) {
  if (!UUID_RE.test(String(p.merchant_trans_id))) return { code: -5 } as const
  const { data: payment, error } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('id', p.merchant_trans_id)
    .maybeSingle()
  if (error) throw error
  if (!payment || payment.provider !== 'click') return { code: -5 } as const

  const { data: ev, error: evErr } = await admin
    .from('events')
    .select('id, status, plan_tier')
    .eq('id', payment.event_id)
    .maybeSingle()
  if (evErr) throw evErr
  if (!ev) return { code: -5 } as const

  // Click sends sums as a float ("390000.00"); we store tiyin.
  const sums = Number(p.amount)
  if (!Number.isFinite(sums) || Math.round(sums * 100) !== payment.amount) return { code: -2 } as const
  return { payment, ev }
}

async function prepare(admin: Admin, p: ClickPayload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await loadOrder(admin, p)
    if (order.code) return clickResponse(p, order.code)
    const { payment, ev } = order
    // The tier changed after checkout — this order's price is stale.
    if (getTierPriceTiyin(ev.plan_tier) !== payment.amount) return clickResponse(p, -2)
    if (payment.status === 'paid' || ev.status === 'active') return clickResponse(p, -4)
    if (payment.status !== 'pending' || ev.status !== 'draft') return clickResponse(p, -9)

    const prepareId = clickIdFor(payment.id)
    const bound = clickOf(payment)
    // Repeat of a prepare we already answered.
    if (bound?.click_trans_id === String(p.click_trans_id)) {
      return clickResponse(p, 0, { merchant_prepare_id: prepareId })
    }
    // Another Click transaction is paying this very order right now.
    if (bound && Date.now() - bound.prepared_at < RESERVATION_WINDOW_MS) return clickResponse(p, -4)
    // …or another payment for the same event is paid / being paid.
    const other = await otherPaymentBlocker(admin, ev.id, payment.id)
    if ('error' in other) throw new Error('payments lookup failed')
    if (other.blocker) return clickResponse(p, -4)

    const tx: ClickTx = {
      click_trans_id: String(p.click_trans_id),
      click_paydoc_id: String(p.click_paydoc_id),
      prepare_id: prepareId,
      prepared_at: Date.now(),
    }
    const res = await casPayment(admin, payment, {
      provider_transaction_id: tx.click_trans_id,
      metadata: withMeta(payment, 'click', tx),
    })
    if (res === 'error') throw new Error('payments update failed')
    if (res === 'conflict') continue
    return clickResponse(p, 0, { merchant_prepare_id: prepareId })
  }
  throw new Error('prepare: too many concurrent writes')
}

async function complete(admin: Admin, p: ClickPayload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const order = await loadOrder(admin, p)
    if (order.code) return clickResponse(p, order.code)
    const { payment } = order

    // Only the transaction we prepared, with the id we gave it.
    const bound = clickOf(payment)
    const confirmId = clickIdFor(payment.id)
    if (
      !bound ||
      bound.click_trans_id !== String(p.click_trans_id) ||
      Number(p.merchant_prepare_id) !== bound.prepare_id
    ) {
      return clickResponse(p, -6)
    }

    if (payment.status === 'paid') {
      // Repeat of a confirmed complete: re-assert activation, answer -4.
      if (!(await activateEvent(admin, payment.event_id))) return clickResponse(p, -7)
      return clickResponse(p, -4, { merchant_confirm_id: confirmId })
    }
    if (payment.status !== 'pending') return clickResponse(p, -9)

    // Click reports the charge failed — close the order.
    if (Number(p.error) < 0) {
      const res = await casPayment(admin, payment, {
        status: 'failed',
        metadata: withMeta(payment, 'click', { ...bound, error: Number(p.error), error_note: p.error_note ?? null }),
      })
      if (res === 'error') throw new Error('payments update failed')
      if (res === 'conflict') continue
      return clickResponse(p, -9)
    }

    // Paid meanwhile through another attempt: cancel this one so Click
    // reverses the charge instead of taking the money twice.
    const other = await otherPaymentBlocker(admin, payment.event_id, payment.id)
    if ('error' in other) throw new Error('payments lookup failed')
    if (other.blocker === 'paid') {
      const res = await casPayment(admin, payment, { status: 'cancelled' })
      if (res === 'error') throw new Error('payments update failed')
      if (res === 'conflict') continue
      return clickResponse(p, -9)
    }

    const res = await casPayment(admin, payment, {
      status: 'paid',
      metadata: withMeta(payment, 'click', { ...bound, completed_at: Date.now() }),
    })
    if (res === 'error') throw new Error('payments update failed')
    if (res === 'conflict') continue
    // On failure Click retries; the paid branch above finishes activation.
    if (!(await activateEvent(admin, payment.event_id))) return clickResponse(p, -7)
    return clickResponse(p, 0, { merchant_confirm_id: confirmId })
  }
  throw new Error('complete: too many concurrent writes')
}
