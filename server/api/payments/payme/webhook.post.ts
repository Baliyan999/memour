import type { Database } from '~/types/database.types'
import { serverSupabaseServiceRole } from '#supabase/server'

/**
 * POST /api/payments/payme/webhook — Payme JSON-RPC 2.0 endpoint.
 *
 * Payme calls this with one of the merchant methods:
 *   CheckPerformTransaction, CreateTransaction, PerformTransaction,
 *   CancelTransaction, CheckTransaction, GetStatement.
 *
 * Authentication: HTTP Basic with username "Paycom" and our
 * PAYME_MERCHANT_KEY. Validate before processing.
 *
 * State machine:
 *   1. CheckPerformTransaction → return allow/{detail} based on event
 *   2. CreateTransaction       → insert/update payments row (state 1)
 *   3. PerformTransaction      → mark payment paid + event active (state 2)
 *   4. CancelTransaction       → mark cancelled (state -1/-2)
 *
 * Errors are returned as JSON-RPC error objects per Payme spec.
 */

interface JsonRpcRequest {
  id: number | string
  method: string
  params: Record<string, any>
}

function err(id: any, code: number, message: string, data?: any) {
  return { jsonrpc: '2.0', id, error: { code, message: { ru: message, uz: message, en: message }, data } }
}

function ok(id: any, result: any) {
  return { jsonrpc: '2.0', id, result }
}

export default defineEventHandler(async (event) => {
  // --- Auth check ---
  const authHeader = getRequestHeader(event, 'authorization') ?? ''
  const merchantKey = process.env.PAYME_MERCHANT_KEY
  if (!merchantKey) {
    // No merchant key configured — refuse everything until set.
    setResponseStatus(event, 200)
    return err(null, -32504, 'Insufficient privilege')
  }
  const expected = `Basic ${Buffer.from(`Paycom:${merchantKey}`).toString('base64')}`
  if (authHeader !== expected) {
    setResponseStatus(event, 200)
    return err(null, -32504, 'Insufficient privilege')
  }

  const rpc = (await readBody(event)) as JsonRpcRequest
  const admin = serverSupabaseServiceRole<Database>(event)

  const account = rpc.params?.account ?? {}
  const paymentId = account.payment_id as string | undefined
  const eventId = account.event_id as string | undefined

  switch (rpc.method) {
    case 'CheckPerformTransaction': {
      if (!eventId)
        return err(rpc.id, -31050, 'Missing event_id', 'event_id')
      const { data: ev } = await admin
        .from('events')
        .select('id, status')
        .eq('id', eventId)
        .maybeSingle()
      if (!ev)
        return err(rpc.id, -31050, 'Event not found', 'event_id')
      if (ev.status === 'active')
        return err(rpc.id, -31099, 'Already paid')
      return ok(rpc.id, { allow: true })
    }

    case 'CreateTransaction': {
      if (!paymentId)
        return err(rpc.id, -31050, 'Missing payment_id', 'payment_id')
      const { data: payment } = await admin
        .from('payments')
        .select('id, status, amount, metadata')
        .eq('id', paymentId)
        .maybeSingle()
      if (!payment)
        return err(rpc.id, -31050, 'Payment not found', 'payment_id')
      if (payment.amount !== Number(rpc.params.amount)) {
        return err(rpc.id, -31001, 'Wrong amount')
      }
      // Idempotent: if already created with same transaction id, just return.
      const existingTx = (payment.metadata as any)?.payme_transaction_id
      if (existingTx && existingTx !== rpc.params.id) {
        return err(rpc.id, -31099, 'Payment already in progress with different transaction')
      }
      const now = Date.now()
      await admin
        .from('payments')
        .update({
          provider_transaction_id: rpc.params.id,
          metadata: { ...(payment.metadata as any || {}), payme_create_time: now, payme_transaction_id: rpc.params.id },
        } as any)
        .eq('id', paymentId)
      return ok(rpc.id, { create_time: now, transaction: paymentId, state: 1 })
    }

    case 'PerformTransaction': {
      const txId = rpc.params.id
      const { data: payment } = await admin
        .from('payments')
        .select('id, status, event_id, metadata')
        .eq('provider_transaction_id', txId)
        .maybeSingle()
      if (!payment)
        return err(rpc.id, -31003, 'Transaction not found')
      const now = Date.now()
      if (payment.status !== 'paid') {
        await admin
          .from('payments')
          .update({
            status: 'paid',
            metadata: { ...(payment.metadata as any || {}), payme_perform_time: now },
          } as any)
          .eq('id', payment.id)
        await admin
          .from('events')
          .update({ status: 'active' })
          .eq('id', payment.event_id)
      }
      return ok(rpc.id, { transaction: payment.id, perform_time: now, state: 2 })
    }

    case 'CancelTransaction': {
      const txId = rpc.params.id
      const { data: payment } = await admin
        .from('payments')
        .select('id, status, metadata')
        .eq('provider_transaction_id', txId)
        .maybeSingle()
      if (!payment)
        return err(rpc.id, -31003, 'Transaction not found')
      const now = Date.now()
      await admin
        .from('payments')
        .update({
          status: 'cancelled',
          metadata: { ...(payment.metadata as any || {}), payme_cancel_time: now, payme_cancel_reason: rpc.params.reason },
        } as any)
        .eq('id', payment.id)
      return ok(rpc.id, { transaction: payment.id, cancel_time: now, state: payment.status === 'paid' ? -2 : -1 })
    }

    case 'CheckTransaction': {
      const txId = rpc.params.id
      const { data: payment } = await admin
        .from('payments')
        .select('id, status, metadata')
        .eq('provider_transaction_id', txId)
        .maybeSingle()
      if (!payment)
        return err(rpc.id, -31003, 'Transaction not found')
      const md = (payment.metadata as any) ?? {}
      const state
        = payment.status === 'paid'
          ? 2
          : payment.status === 'cancelled'
            ? (md.payme_perform_time ? -2 : -1)
            : 1
      return ok(rpc.id, {
        create_time: md.payme_create_time ?? 0,
        perform_time: md.payme_perform_time ?? 0,
        cancel_time: md.payme_cancel_time ?? 0,
        transaction: payment.id,
        state,
        reason: md.payme_cancel_reason ?? null,
      })
    }

    default:
      return err(rpc.id, -32601, `Unknown method: ${rpc.method}`)
  }
})
