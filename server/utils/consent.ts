import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import ruMessages from '~~/i18n/locales/ru.json'
import uzMessages from '~~/i18n/locales/uz.json'
import {
  consentTextKeys,
  consentVersions,
  legalDocsLive,
  requiredConsents,
  type ConsentContext,
  type ConsentDoc,
  type LegalConfig,
} from '#shared/legal'
import { getTrustedClientIp } from './rate-limit'
import { legalTextSha256, type Locale } from './legal-docs'
import { fail } from './errors'

/**
 * Consents with evidence (table consent_events, shared/legal.ts).
 *
 * The client sends what the person ticked as `consent: { doc: version }`
 * — the versions of the texts it showed. An endpoint calls
 * requireConsent() before it does anything, and recordConsent() once it
 * knows who the person is:
 *
 *   lead          /api/lead                    privacy
 *   login         /api/auth/phone/send+verify, /api/auth/email/send
 *                 (+ middleware/auth-code.ts)  terms, privacy
 *   guest_upload  /api/guest/binding (record), /api/guest/upload (check)
 *                                              terms, guest_licence, privacy
 *   checkout      /api/checkout/[provider]     offer (terms until an offer is published)
 *
 * Errors: 422 consent_required (a box wasn't ticked), 409
 * consent_outdated (the page showed an older version — reload).
 *
 * What a record proves (consent_events):
 *   text_sha256            the document accepted — the published text
 *                          (legal-docs.ts) or, for the short interim
 *                          pages and the guest licence, which have no
 *                          document of their own, the wording shown;
 *   extra.consent_text     { keys, sha256 } of the wording shown with
 *                          the box (shared/legal.ts consentTextKeys),
 *                          taken from i18n/locales in the record's
 *                          language — so a wording change is visible in
 *                          the records even if nobody bumped a version.
 */

/** The `consent` field of a request body. */
export const consentField = z.record(z.string().max(20), z.string().max(40)).optional()

export interface RequiredConsent { document: ConsentDoc; version: string }

function isLive(): boolean {
  return legalDocsLive((useRuntimeConfig().public.legal ?? {}) as LegalConfig)
}

const MESSAGES: Record<Locale, unknown> = { ru: ruMessages, uz: uzMessages }

function message(locale: Locale, key: string): string | null {
  let node: unknown = MESSAGES[locale]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : null
}

/** sha256 of the raw i18n messages shown, as JSON [[key, message], …]. */
function shownTextSha256(keys: string[], locale: Locale): string {
  return createHash('sha256').update(JSON.stringify(keys.map((k) => [k, message(locale, k)]))).digest('hex')
}

/** The documents `context` needs at their current versions — or the request fails. */
export function requireConsent(context: ConsentContext, accepted: Record<string, string> | undefined): RequiredConsent[] {
  const live = isLive()
  const versions = consentVersions(live)
  const docs = requiredConsents(context, live).map((document) => ({ document, version: versions[document]! }))
  for (const d of docs) {
    const got = accepted?.[d.document]
    if (!got) fail(422, 'consent_required')
    if (got !== d.version) fail(409, 'consent_outdated')
  }
  return docs
}

export type ConsentSubject =
  | { type: 'lead'; leadId: string; phone?: string | null }
  | { type: 'couple'; userId?: string | null; phone?: string | null; email?: string | null }
  | { type: 'guest'; eventId: string; deviceId: string; guestName?: string | null }

/**
 * One row per document. Returns the new row ids. A failed write fails
 * the request: an action we can't prove consent for doesn't happen.
 */
export async function recordConsent(
  event: H3Event,
  args: {
    context: ConsentContext
    subject: ConsentSubject
    docs: RequiredConsent[]
    locale?: Locale | null
    method?: 'checkbox' | 'checkbox+otp' | 'email_link'
    paymentId?: string | null
    extra?: Record<string, unknown>
  },
): Promise<string[]> {
  const admin = serverSupabaseServiceRole<Database>(event)
  const locale: Locale = args.locale === 'ru' ? 'ru' : 'uz'
  const s = args.subject
  const who = {
    subject_type: s.type,
    lead_id: s.type === 'lead' ? s.leadId : null,
    user_id: s.type === 'couple' ? s.userId ?? null : null,
    event_id: s.type === 'guest' ? s.eventId : null,
    device_id: s.type === 'guest' ? s.deviceId : null,
    phone: s.type !== 'guest' ? s.phone ?? null : null,
    email: s.type === 'couple' ? s.email ?? null : null,
    guest_name: s.type === 'guest' ? s.guestName ?? null : null,
  }
  const evidence = {
    ip: getTrustedClientIp(event),
    user_agent: getRequestHeader(event, 'user-agent')?.slice(0, 512) ?? null,
  }
  const live = isLive()
  const rows = await Promise.all(
    args.docs.map(async (d) => {
      const keys = consentTextKeys(args.context, d.document, live)
      const shown = shownTextSha256(keys, locale)
      return {
        context: args.context,
        ...who,
        document: d.document,
        version: d.version,
        text_sha256: live && d.document !== 'guest_licence' ? await legalTextSha256(d.document, locale) : shown,
        method: args.method ?? 'checkbox',
        locale,
        ...evidence,
        payment_id: args.paymentId ?? null,
        extra: { ...args.extra, consent_text: { keys, sha256: shown } } as Database['public']['Tables']['consent_events']['Insert']['extra'],
      }
    }),
  )
  const { data, error } = await admin.from('consent_events').insert(rows).select('id')
  if (error || !data) {
    console.error('[consent] insert failed', error)
    fail(500, 'server_error')
  }
  return data.map((r) => r.id)
}

// The rows /api/auth/email/send wrote are looked for within the life of
// a link (GoTrue's default is an hour; a day covers a longer setting).
const EMAIL_LINK_WINDOW_MS = 24 * 60 * 60_000

/**
 * The email link was opened (middleware/auth-code.ts): the account that
 * opened it confirms what was ticked when the link was requested. Those
 * rows name only the address; these carry the account id too, with
 * method 'email_link' — the email counterpart of the phone login's
 * 'checkbox+otp' — the same documents and versions, and the ids of the
 * rows they confirm in extra.confirms.
 */
export async function confirmEmailConsent(
  event: H3Event,
  args: { userId: string; email: string | null; locale: Locale },
): Promise<void> {
  if (!args.email) return
  const { data, error } = await serverSupabaseServiceRole<Database>(event)
    .from('consent_events')
    .select('id, document, version')
    .eq('context', 'login')
    .eq('subject_type', 'couple')
    .eq('method', 'checkbox')
    .eq('email', args.email.toLowerCase())
    .is('user_id', null)
    .gte('occurred_at', new Date(Date.now() - EMAIL_LINK_WINDOW_MS).toISOString())
    .order('occurred_at', { ascending: false })
  if (error) {
    console.error('[consent] email lookup failed', error)
    return
  }
  const latest = new Map<string, { id: string; version: string }>()
  for (const r of data ?? []) if (!latest.has(r.document)) latest.set(r.document, r)
  if (!latest.size) {
    console.warn('[consent] email login without a consent on record')
    return
  }
  await recordConsent(event, {
    context: 'login',
    subject: { type: 'couple', userId: args.userId, email: args.email.toLowerCase() },
    docs: [...latest].map(([document, r]) => ({ document: document as ConsentDoc, version: r.version })),
    locale: args.locale,
    method: 'email_link',
    extra: { channel: 'email', confirms: [...latest.values()].map((r) => r.id) },
  })
}

/** Has this device accepted the current guest texts for this event? */
export async function hasGuestConsent(event: H3Event, eventId: string, deviceId: string): Promise<boolean> {
  const live = isLive()
  const versions = consentVersions(live)
  const needed = requiredConsents('guest_upload', live)
  const { data, error } = await serverSupabaseServiceRole<Database>(event)
    .from('consent_events')
    .select('document, version')
    .eq('subject_type', 'guest')
    .eq('event_id', eventId)
    .eq('device_id', deviceId)
    .in('document', needed)
  if (error) {
    console.error('[consent] guest lookup failed', error)
    fail(500, 'server_error')
  }
  return needed.every((doc) => (data ?? []).some((r) => r.document === doc && r.version === versions[doc]))
}
