import { timingSafeEqual } from 'node:crypto'
import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { adminLink, sendTelegram, shortId } from './telegram'

/**
 * Shared bits of the payment flow: checkout, the Payme / Click webhooks
 * and the couple's status endpoint all agree on these rules.
 *
 * Writes to `payments` go through `casPayment()` — a compare-and-set on
 * `updated_at` (bumped by trigger on every update). Providers retry and
 * race each other; a write that lost the race changes zero rows and the
 * caller re-reads and decides again, so nothing is applied twice.
 */

export type Admin = ReturnType<typeof serverSupabaseServiceRole<Database>>
export type PaymentRow = Database['public']['Tables']['payments']['Row']
export type PaymentProvider = 'payme' | 'click'

export const PAYMENT_COLUMNS =
  'id, event_id, provider, amount, currency, status, provider_transaction_id, metadata, created_at, updated_at'

/**
 * How long a half-finished payment on one provider blocks starting a
 * second one for the same event. Covers the seconds-to-minutes between
 * Payme Create → Perform or Click prepare → complete; an abandoned
 * attempt stops blocking after this.
 */
export const RESERVATION_WINDOW_MS = 15 * 60_000

/**
 * The dev fallback (mark paid without a provider) exists only for local
 * development: never in a production build, and only when asked for.
 */
export function paymentsDevMode(): boolean {
  return process.env.PAYMENTS_DEV_MODE === 'true' && process.env.NODE_ENV !== 'production'
}

/** Both the checkout link and the webhook need the full set of keys. */
export function providerConfigured(provider: PaymentProvider): boolean {
  const env = process.env
  return provider === 'payme'
    ? !!(env.PAYME_MERCHANT_ID && env.PAYME_MERCHANT_KEY)
    : !!(env.CLICK_SERVICE_ID && env.CLICK_MERCHANT_ID && env.CLICK_SECRET_KEY)
}

/**
 * A paid row that actually moved money. Rows the old dev fallback wrote
 * in production are `paid` with no provider transaction; 'manual' is an
 * admin-recorded payment (cash / transfer) and has none by design.
 */
export function countsAsPaid(p: Pick<PaymentRow, 'status' | 'provider' | 'provider_transaction_id'>): boolean {
  return p.status === 'paid' && (p.provider === 'manual' || !!p.provider_transaction_id)
}

/** A provider has bound a transaction to this pending row and may still charge it. */
export function reservationLive(p: PaymentRow, now = Date.now()): boolean {
  return now < reservationEnd(p)
}

/** When this row's reservation stops blocking a new checkout (epoch ms; 0 = no reservation). */
export function reservationEnd(p: PaymentRow): number {
  if (p.status !== 'pending') return 0
  const md = (p.metadata as any) ?? {}
  if (p.provider === 'payme' && md.payme?.state === 1) {
    return Number(md.payme.create_time) + RESERVATION_WINDOW_MS
  }
  if (p.provider === 'click' && md.click?.prepared_at) {
    return Number(md.click.prepared_at) + RESERVATION_WINDOW_MS
  }
  return 0
}

/**
 * Is some *other* payment of this event already paid, or being paid
 * right now? Used before a provider is allowed to charge `selfId`, so a
 * couple can't end up paying twice through two tabs or two providers.
 */
export async function otherPaymentBlocker(
  admin: Admin,
  eventId: string,
  selfId: string | null,
): Promise<{ blocker: 'paid' | 'in_progress' | null } | { error: true }> {
  const { data, error } = await admin
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('event_id', eventId)
    .in('status', ['paid', 'pending'])
  if (error) return { error: true }
  const others = (data ?? []).filter((p) => p.id !== selfId)
  if (others.some(countsAsPaid)) return { blocker: 'paid' }
  const now = Date.now()
  if (others.some((p) => reservationLive(p, now))) return { blocker: 'in_progress' }
  return { blocker: null }
}

/**
 * Compare-and-set a payments row: applies `patch` only if the row is
 * still the version we read. Returns the new row, 'conflict' when
 * someone else wrote first, or 'error' when the database failed.
 */
export async function casPayment(
  admin: Admin,
  row: Pick<PaymentRow, 'id' | 'updated_at'>,
  patch: Database['public']['Tables']['payments']['Update'],
): Promise<PaymentRow | 'conflict' | 'error'> {
  const { data, error } = await admin
    .from('payments')
    .update(patch)
    .eq('id', row.id)
    .eq('updated_at', row.updated_at)
    .select(PAYMENT_COLUMNS)
  if (error) return 'error'
  return data?.[0] ?? 'conflict'
}

/** metadata with one provider section replaced, other keys kept. */
export function withMeta(row: Pick<PaymentRow, 'metadata'>, key: string, value: unknown) {
  const md = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}
  return { ...md, [key]: value } as Database['public']['Tables']['payments']['Update']['metadata']
}

/**
 * draft → active once a payment is in. Conditional, so an archived event
 * is never revived and a repeat call is a no-op. False = database error
 * (callers report it to the provider, which retries).
 *
 * The call that actually flips the event tells the team on Telegram
 * (TELEGRAM_LEAD_CHAT_ID): the couple can download their QR codes now.
 * Not awaited — a provider must never wait on Telegram.
 */
export async function activateEvent(admin: Admin, eventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('events')
    .update({ status: 'active' })
    .eq('id', eventId)
    .eq('status', 'draft')
    .select('plan_tier')
  if (error) return false
  for (const ev of data ?? []) {
    const tier = (ev.plan_tier ?? 'basic').replace(/^./, (c) => c.toUpperCase())
    // No couple names in Telegram (server/utils/telegram.ts).
    void sendTelegram(
      `💳 Оплачено: событие #${shortId(eventId)} · ${tier}\n`
      + 'Событие активно, пара может скачать QR-коды.\n'
      + adminLink(`/admin/event/${eventId}`),
    )
  }
  return true
}

/**
 * After a refund: active → draft, unless another payment still covers
 * the event. False = database error.
 */
export async function deactivateEventAfterRefund(admin: Admin, eventId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('payments')
    .select('status, provider, provider_transaction_id')
    .eq('event_id', eventId)
    .eq('status', 'paid')
  if (error) return false
  if ((data ?? []).some(countsAsPaid)) return true
  const { error: upErr } = await admin
    .from('events')
    .update({ status: 'draft' })
    .eq('id', eventId)
    .eq('status', 'active')
  return !upErr
}

/** Start of the wedding day in Tashkent, ms since epoch. */
export function weddingDayStartMs(weddingDate: string): number {
  return Date.parse(`${weddingDate}T00:00:00+05:00`)
}

/** Constant-time string comparison for secrets and signatures. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
