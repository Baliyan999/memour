import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { getTierPriceTiyin } from '../../../utils/pricing'
import {
  PAYMENT_COLUMNS,
  UUID_RE,
  activateEvent,
  casPayment,
  deactivateEventAfterRefund,
  otherPaymentBlocker,
  safeEqual,
  weddingDayStartMs,
  withMeta,
  type Admin,
  type PaymentRow,
} from '../../../utils/payments'

/**
 * POST /api/payments/payme/webhook — Payme Merchant API (JSON-RPC 2.0).
 * Spec: https://developer.help.paycom.uz/metody-merchant-api/
 *
 * Methods: CheckPerformTransaction, CreateTransaction, PerformTransaction,
 * CancelTransaction, CheckTransaction, GetStatement, SetFiscalData,
 * ChangePassword (refused — the key lives in env, see below).
 *
 * Authentication: HTTP Basic "<PAYME_LOGIN|Paycom>:<PAYME_MERCHANT_KEY>".
 * Every answer is HTTP 200 — Payme reads any other status as -32400.
 *
 * Account: { event_id, payment_id } — one payments row is one order and
 * carries at most one Payme transaction (provider_transaction_id = Payme
 * id, the rest in metadata.payme).
 *
 * Transaction states (metadata.payme.state / payments.status):
 *    1  created, waiting for perform   pending
 *    2  performed → event active       paid
 *   -1  cancelled before perform       cancelled
 *   -2  cancelled after perform        refunded → event back to draft
 * A transaction not performed within 12 h of Payme's `time` is cancelled
 * with reason 4. Repeated calls return the stored result unchanged —
 * Payme retries every call whose answer it lost.
 */

const PAYME_TIMEOUT_MS = 43_200_000

type Msg = { ru: string; uz: string; en: string }

// Payme shows `message` to the payer — keep it human, in all three languages.
const MSG = {
  auth: {
    ru: 'Недостаточно привилегий для выполнения метода.',
    uz: 'Ushbu amalni bajarish uchun huquq yetarli emas.',
    en: 'Insufficient privileges to perform this method.',
  },
  parse: { ru: 'Ошибка разбора JSON.', uz: 'JSONʼni oʻqib boʻlmadi.', en: 'JSON parse error.' },
  invalidRequest: { ru: 'Неверный запрос.', uz: 'Soʻrov notoʻgʻri.', en: 'Invalid request.' },
  methodNotFound: { ru: 'Метод не найден.', uz: 'Metod topilmadi.', en: 'Method not found.' },
  system: {
    ru: 'Системная ошибка. Попробуйте ещё раз чуть позже.',
    uz: 'Tizim xatosi. Birozdan soʻng qayta urinib koʻring.',
    en: 'System error. Please try again a little later.',
  },
  wrongAmount: { ru: 'Неверная сумма платежа.', uz: 'Toʻlov summasi notoʻgʻri.', en: 'Incorrect payment amount.' },
  txNotFound: { ru: 'Транзакция не найдена.', uz: 'Tranzaksiya topilmadi.', en: 'Transaction not found.' },
  cannotPerform: {
    ru: 'Невозможно выполнить операцию.',
    uz: 'Amalni bajarib boʻlmaydi.',
    en: 'Unable to perform the operation.',
  },
  cannotCancel: {
    ru: 'Услуга уже оказана — отменить платёж нельзя.',
    uz: 'Xizmat allaqachon koʻrsatilgan — toʻlovni bekor qilib boʻlmaydi.',
    en: 'The service has already been provided, so the payment cannot be cancelled.',
  },
  orderNotFound: {
    ru: 'Заказ не найден. Вернитесь в Memour и начните оплату заново.',
    uz: 'Buyurtma topilmadi. Memourʼga qayting va toʻlovni qaytadan boshlang.',
    en: 'Order not found. Go back to Memour and start the payment again.',
  },
  orderUnavailable: {
    ru: 'Этот заказ больше недоступен. Вернитесь в Memour и начните оплату заново.',
    uz: 'Bu buyurtma endi mavjud emas. Memourʼga qayting va toʻlovni qaytadan boshlang.',
    en: 'This order is no longer available. Go back to Memour and start the payment again.',
  },
  alreadyPaid: {
    ru: 'Это событие уже оплачено.',
    uz: 'Bu tadbir uchun toʻlov allaqachon qilingan.',
    en: 'This event has already been paid for.',
  },
  inProgress: {
    ru: 'Оплата этого события уже начата. Завершите её или начните заново через 15 минут.',
    uz: 'Bu tadbir uchun toʻlov allaqachon boshlangan. Uni yakunlang yoki 15 daqiqadan keyin qaytadan boshlang.',
    en: 'A payment for this event has already been started. Finish it, or start again in 15 minutes.',
  },
} satisfies Record<string, Msg>

class RpcError extends Error {
  constructor(public code: number, public msg: Msg | string, public data?: string) {
    super(`payme ${code}`)
  }
}

function rpcFail(code: number, msg: Msg | string, data?: string): never {
  throw new RpcError(code, msg, data)
}

function err(id: unknown, code: number, message: Msg | string, data?: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function isObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function authorized(header: string | undefined): boolean {
  const key = process.env.PAYME_MERCHANT_KEY
  if (!key || !header?.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon < 0) return false
  const login = decoded.slice(0, colon)
  return login === (process.env.PAYME_LOGIN || 'Paycom') && safeEqual(decoded.slice(colon + 1), key)
}

export default defineEventHandler(async (event) => {
  let rpc: any
  try {
    rpc = JSON.parse((await readRawBody(event, 'utf8')) ?? '')
  } catch {
    return err(null, -32700, MSG.parse)
  }
  const id = isObject(rpc) ? rpc.id : null

  if (!authorized(getRequestHeader(event, 'authorization'))) return err(id, -32504, MSG.auth)
  if (!isObject(rpc) || typeof rpc.method !== 'string' || !isObject(rpc.params)) {
    return err(id, -32600, MSG.invalidRequest)
  }

  const admin = serverSupabaseServiceRole<Database>(event)
  const params = rpc.params

  try {
    switch (rpc.method) {
      case 'CheckPerformTransaction': return ok(id, await checkPerformTransaction(admin, params))
      case 'CreateTransaction': return ok(id, await createTransaction(admin, params))
      case 'PerformTransaction': return ok(id, await performTransaction(admin, params))
      case 'CancelTransaction': return ok(id, await cancelTransaction(admin, params))
      case 'CheckTransaction': return ok(id, await checkTransaction(admin, params))
      case 'GetStatement': return ok(id, await getStatement(admin, params))
      case 'SetFiscalData': return ok(id, await setFiscalData(admin, params))
      case 'ChangePassword':
        // The key is PAYME_MERCHANT_KEY in the server env; we can't persist
        // a new one from here. Refusing keeps the old key working — rotate
        // it by updating the env instead.
        console.warn('[payme] ChangePassword refused: update PAYME_MERCHANT_KEY on the server to rotate the key')
        return err(id, -32504, MSG.auth)
      default:
        return err(id, -32601, MSG.methodNotFound, rpc.method)
    }
  } catch (e) {
    if (e instanceof RpcError) return err(id, e.code, e.msg, e.data)
    console.error(`[payme] ${rpc.method} failed`, e)
    return err(id, -32400, MSG.system)
  }
})

// ---------------------------------------------------------------------------

interface PaymeTx {
  id: string
  time: number
  amount: number
  account: Record<string, unknown>
  create_time: number
  perform_time: number
  cancel_time: number
  state: 1 | 2 | -1 | -2
  reason: number | null
  fiscal?: { perform_data?: unknown; cancel_data?: unknown }
}

const txOf = (row: PaymentRow) => (row.metadata as any).payme as PaymeTx
const expired = (tx: PaymeTx) => Date.now() - tx.time > PAYME_TIMEOUT_MS

function requireInt(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) rpcFail(-32600, MSG.invalidRequest)
  return v
}

function requireTxId(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 64) rpcFail(-32600, MSG.invalidRequest)
  return v
}

async function findTx(admin: Admin, txId: string): Promise<PaymentRow | null> {
  const { data, error } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('provider', 'payme')
    .eq('provider_transaction_id', txId)
    .order('created_at')
    .limit(1)
  if (error) throw error
  const row = data?.[0] ?? null
  return row && txOf(row) ? row : null
}

async function writeTx(admin: Admin, row: PaymentRow, patch: Partial<PaymeTx>, status?: string) {
  const res = await casPayment(admin, row, {
    ...(status ? { status } : {}),
    metadata: withMeta(row, 'payme', { ...txOf(row), ...patch }),
  })
  if (res === 'error') throw new Error('payments update failed')
  return res
}

/**
 * Loads the order behind `account` and checks it against the amount.
 * Throws the Payme error the payer should see.
 */
async function loadOrder(admin: Admin, account: unknown, amount: number) {
  const acc = isObject(account) ? account : {}
  const paymentId = acc.payment_id
  if (typeof paymentId !== 'string' || !UUID_RE.test(paymentId)) rpcFail(-31050, MSG.orderNotFound, 'payment_id')

  const { data: payment, error } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('id', paymentId)
    .maybeSingle()
  if (error) throw error
  if (!payment || payment.provider !== 'payme') rpcFail(-31050, MSG.orderNotFound, 'payment_id')
  if (acc.event_id !== undefined && acc.event_id !== payment!.event_id) {
    rpcFail(-31051, MSG.orderNotFound, 'event_id')
  }

  const { data: ev, error: evErr } = await admin
    .from('events')
    .select('id, status, plan_tier')
    .eq('id', payment!.event_id)
    .maybeSingle()
  if (evErr) throw evErr
  if (!ev) rpcFail(-31050, MSG.orderNotFound, 'payment_id')

  if (amount !== payment!.amount) rpcFail(-31001, MSG.wrongAmount)
  // The tier changed after checkout — this order's price is stale.
  if (getTierPriceTiyin(ev!.plan_tier) !== payment!.amount) rpcFail(-31052, MSG.orderUnavailable, 'payment_id')

  return { payment: payment!, ev: ev! }
}

/** The order may be charged: still pending, event still a draft, nothing else paying for it. */
async function assertPayable(admin: Admin, payment: PaymentRow, ev: { id: string; status: string }) {
  if (payment.status === 'paid' || ev.status === 'active') rpcFail(-31052, MSG.alreadyPaid, 'payment_id')
  if (payment.status !== 'pending' || ev.status !== 'draft') rpcFail(-31052, MSG.orderUnavailable, 'payment_id')
  const other = await otherPaymentBlocker(admin, ev.id, payment.id)
  if ('error' in other) throw new Error('payments lookup failed')
  if (other.blocker === 'paid') rpcFail(-31052, MSG.alreadyPaid, 'payment_id')
  if (other.blocker === 'in_progress') rpcFail(-31052, MSG.inProgress, 'payment_id')
}

/**
 * Fiscal receipt line (ИКПУ + package code + VAT), required by the tax
 * rules for Payme receipts. Omitted until all three are configured.
 */
let fiscalWarned = false
function fiscalDetail(amount: number, tier: string | null) {
  const code = process.env.PAYME_IKPU_CODE
  const packageCode = process.env.PAYME_PACKAGE_CODE
  // An empty value is "not set", not 0 % (Number('') is 0).
  const vat = Number(process.env.PAYME_VAT_PERCENT || NaN)
  if (!code || !packageCode || !Number.isFinite(vat)) {
    if (!fiscalWarned) console.warn('[payme] fiscal detail off: set PAYME_IKPU_CODE, PAYME_PACKAGE_CODE, PAYME_VAT_PERCENT')
    fiscalWarned = true
    return undefined
  }
  const tierName = (tier ?? 'basic').replace(/^./, (c) => c.toUpperCase())
  return {
    receipt_type: 0,
    items: [{ title: `Memour ${tierName}`, price: amount, count: 1, code, package_code: packageCode, vat_percent: vat }],
  }
}

async function checkPerformTransaction(admin: Admin, params: Record<string, any>) {
  const amount = requireInt(params.amount)
  const { payment, ev } = await loadOrder(admin, params.account, amount)
  await assertPayable(admin, payment, ev)
  const detail = fiscalDetail(payment.amount, ev.plan_tier)
  return { allow: true, ...(detail ? { detail } : {}) }
}

async function createTransaction(admin: Admin, params: Record<string, any>) {
  const txId = requireTxId(params.id)
  const time = requireInt(params.time)
  const amount = requireInt(params.amount)

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findTx(admin, txId)
    if (existing) {
      // Repeat of a Create we already answered: same answer, if still valid.
      const tx = txOf(existing)
      if (tx.state !== 1) rpcFail(-31008, MSG.cannotPerform)
      if (expired(tx)) {
        if ((await writeTx(admin, existing, { state: -1, cancel_time: Date.now(), reason: 4 }, 'cancelled')) === 'conflict') continue
        rpcFail(-31008, MSG.cannotPerform)
      }
      if (tx.amount !== amount) rpcFail(-31001, MSG.wrongAmount)
      return { create_time: tx.create_time, transaction: existing.id, state: 1 }
    }

    const { payment, ev } = await loadOrder(admin, params.account, amount)
    // Another Payme transaction is already waiting on this order.
    if (payment.status === 'pending' && payment.provider_transaction_id) rpcFail(-31008, MSG.cannotPerform)
    await assertPayable(admin, payment, ev)
    if (Date.now() - time > PAYME_TIMEOUT_MS) rpcFail(-31008, MSG.cannotPerform)

    const tx: PaymeTx = {
      id: txId,
      time,
      amount,
      account: isObject(params.account) ? params.account : {},
      create_time: Date.now(),
      perform_time: 0,
      cancel_time: 0,
      state: 1,
      reason: null,
    }
    const res = await casPayment(admin, payment, {
      provider_transaction_id: txId,
      metadata: withMeta(payment, 'payme', tx),
    })
    if (res === 'error') throw new Error('payments update failed')
    if (res === 'conflict') continue
    return { create_time: tx.create_time, transaction: payment.id, state: 1 }
  }
  throw new Error('CreateTransaction: too many concurrent writes')
}

async function performTransaction(admin: Admin, params: Record<string, any>) {
  const txId = requireTxId(params.id)

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await findTx(admin, txId)
    if (!row) rpcFail(-31003, MSG.txNotFound)
    const tx = txOf(row!)

    if (tx.state === 2) {
      // Repeat: re-assert activation in case it failed last time.
      if (!(await activateEvent(admin, row!.event_id))) throw new Error('event activation failed')
      return { transaction: row!.id, perform_time: tx.perform_time, state: 2 }
    }
    if (tx.state !== 1) rpcFail(-31008, MSG.cannotPerform)
    if (expired(tx)) {
      if ((await writeTx(admin, row!, { state: -1, cancel_time: Date.now(), reason: 4 }, 'cancelled')) === 'conflict') continue
      rpcFail(-31008, MSG.cannotPerform)
    }
    // Paid meanwhile through another attempt — refuse, Payme cancels and
    // releases the money instead of charging twice.
    const other = await otherPaymentBlocker(admin, row!.event_id, row!.id)
    if ('error' in other) throw new Error('payments lookup failed')
    if (other.blocker === 'paid') rpcFail(-31008, MSG.alreadyPaid)

    const performTime = Date.now()
    if ((await writeTx(admin, row!, { state: 2, perform_time: performTime }, 'paid')) === 'conflict') continue
    // On failure Payme gets -32400 and retries; the state-2 branch above
    // finishes the activation.
    if (!(await activateEvent(admin, row!.event_id))) throw new Error('event activation failed')
    return { transaction: row!.id, perform_time: performTime, state: 2 }
  }
  throw new Error('PerformTransaction: too many concurrent writes')
}

/**
 * Once guests have uploaded or the wedding day has come, the service is
 * delivered — Payme must not refund it (-31007).
 */
async function serviceDelivered(admin: Admin, eventId: string): Promise<boolean> {
  const { data: ev, error } = await admin.from('events').select('wedding_date').eq('id', eventId).maybeSingle()
  if (error) throw error
  if (ev && Date.now() >= weddingDayStartMs(ev.wedding_date)) return true
  const { count, error: phErr } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
  if (phErr) throw phErr
  return (count ?? 0) > 0
}

async function cancelTransaction(admin: Admin, params: Record<string, any>) {
  const txId = requireTxId(params.id)
  const reason = requireInt(params.reason)

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await findTx(admin, txId)
    if (!row) rpcFail(-31003, MSG.txNotFound)
    const tx = txOf(row!)

    if (tx.state === -1 || tx.state === -2) {
      if (tx.state === -2 && !(await deactivateEventAfterRefund(admin, row!.event_id))) {
        throw new Error('event deactivation failed')
      }
      return { transaction: row!.id, cancel_time: tx.cancel_time, state: tx.state }
    }

    const cancelTime = Date.now()
    if (tx.state === 1) {
      if ((await writeTx(admin, row!, { state: -1, cancel_time: cancelTime, reason }, 'cancelled')) === 'conflict') continue
      return { transaction: row!.id, cancel_time: cancelTime, state: -1 }
    }

    // state 2 → refund: the money goes back, so does the activation.
    if (await serviceDelivered(admin, row!.event_id)) rpcFail(-31007, MSG.cannotCancel)
    if ((await writeTx(admin, row!, { state: -2, cancel_time: cancelTime, reason }, 'refunded')) === 'conflict') continue
    if (!(await deactivateEventAfterRefund(admin, row!.event_id))) throw new Error('event deactivation failed')
    return { transaction: row!.id, cancel_time: cancelTime, state: -2 }
  }
  throw new Error('CancelTransaction: too many concurrent writes')
}

async function checkTransaction(admin: Admin, params: Record<string, any>) {
  const row = await findTx(admin, requireTxId(params.id))
  if (!row) rpcFail(-31003, MSG.txNotFound)
  const tx = txOf(row!)
  return {
    create_time: tx.create_time,
    perform_time: tx.perform_time,
    cancel_time: tx.cancel_time,
    transaction: row!.id,
    state: tx.state,
    reason: tx.reason,
  }
}

/** Reconciliation: every transaction created in [from, to] by Payme time, oldest first. */
async function getStatement(admin: Admin, params: Record<string, any>) {
  const from = requireInt(params.from)
  const to = requireInt(params.to)
  const { data, error } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('provider', 'payme')
    .not('provider_transaction_id', 'is', null)
    .gte('metadata->payme->time', from)
    .lte('metadata->payme->time', to)
    .order('created_at')
  if (error) throw error
  const transactions = (data ?? [])
    .filter((row) => txOf(row) && txOf(row).time >= from && txOf(row).time <= to)
    .map((row) => {
      const tx = txOf(row)
      return {
        id: tx.id,
        time: tx.time,
        amount: tx.amount,
        account: tx.account,
        create_time: tx.create_time,
        perform_time: tx.perform_time,
        cancel_time: tx.cancel_time,
        transaction: row.id,
        state: tx.state,
        reason: tx.reason,
      }
    })
    .sort((a, b) => a.time - b.time)
  return { transactions }
}

/** Payme reports the fiscal receipt of a perform / cancel; we keep it on the transaction. */
async function setFiscalData(admin: Admin, params: Record<string, any>) {
  if (typeof params.id !== 'string' || !params.id) rpcFail(-32602, 'id')
  if (params.type !== 'PERFORM' && params.type !== 'CANCEL') rpcFail(-32602, 'type')
  if (!isObject(params.fiscal_data)) rpcFail(-32602, 'fiscal_data')
  const key = params.type === 'PERFORM' ? 'perform_data' : 'cancel_data'

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await findTx(admin, params.id)
    if (!row) rpcFail(-32001, 'Чек с таким id не найден')
    const fiscal = { ...(txOf(row!).fiscal ?? {}), [key]: params.fiscal_data }
    if ((await writeTx(admin, row!, { fiscal })) === 'conflict') continue
    return { success: true }
  }
  throw new Error('SetFiscalData: too many concurrent writes')
}
