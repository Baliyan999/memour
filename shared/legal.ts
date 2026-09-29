import meta from './legal-meta.json'

/**
 * Legal documents and the versions people accept — one source of truth
 * for the pages, the consent checkboxes and the server that records
 * consents (server/utils/consent.ts).
 *
 * Two editions of /privacy and /terms exist:
 *   - interim: the short pages in app/pages/{privacy,terms}.vue, served
 *     until the full documents can be published;
 *   - full: generated from the owner's drafts by
 *     scripts/legal-publish.mjs (server/assets/legal/**). They go live
 *     only when the operator's details are configured (runtime config
 *     public.legal, NUXT_PUBLIC_LEGAL_*) AND the generated texts have
 *     nothing left to do: no open placeholder, no owner note the script
 *     removed ([СДЕЛАТЬ …] / [ПРОВЕРИТЬ …] — statements the drafts say
 *     are not true yet), no reference to a removed appendix or a page
 *     the site doesn't have (legal-meta.json `open` / `todo`; a count
 *     that is missing blocks too). The public offer (/offer) exists only as
 *     a full document; until then checkout refers to the terms, whose
 *     interim edition carries the refund rules.
 *
 * Versions are dates. Interim ones carry an "interim-" prefix, so a
 * record of the short page can never be mistaken for one of a full
 * document published on the same day. Bump an interim date whenever
 * that page or its checkbox text changes (a second change on one day:
 * ".2", ".3" …); full versions come from shared/legal-meta.json (the
 * date the generated text last changed). GUEST_LICENCE_VERSION covers
 * the notice and checkboxes on the guest welcome screen
 * (guest.consent.* keys). Whatever the version says, each record also
 * carries the hash of the exact wording shown (consentTextKeys below).
 */
export const LEGAL_DOCS = ['privacy', 'terms', 'offer'] as const
export type LegalDoc = (typeof LEGAL_DOCS)[number]

/** What a consent record can refer to. */
export const CONSENT_DOCS = ['privacy', 'terms', 'offer', 'guest_licence'] as const
export type ConsentDoc = (typeof CONSENT_DOCS)[number]

/** Where consent is asked (consent_events.context). */
export const CONSENT_CONTEXTS = ['lead', 'login', 'guest_upload', 'checkout'] as const
export type ConsentContext = (typeof CONSENT_CONTEXTS)[number]

export const INTERIM_VERSIONS = { privacy: 'interim-2026-09-28', terms: 'interim-2026-09-28' } as const
export const GUEST_LICENCE_VERSION = '2026-09-28.2'

type Meta = Record<LegalDoc, { version: string; sha256: string; open: Record<string, number>; todo?: Record<string, number> }>
const META = meta as Meta
const LOCALES = ['uz', 'ru'] as const

/** public.legal in runtime config (nuxt.config). */
export interface LegalConfig {
  entityName?: string
  entityNameRu?: string
  entityInn?: string
  entityRegistration?: string
  entityRegistrationRu?: string
  entityAddress?: string
  entityAddressRu?: string
  entityPostalAddress?: string
  entityPostalAddressRu?: string
  entityPhone?: string
  entityEmail?: string
  entityBank?: string
  entityBankRu?: string
  effectiveDate?: string
  preview?: boolean | string
}

/** Operator details a full document cannot be published without (env: NUXT_PUBLIC_LEGAL_<SNAKE_CASE>). */
export const LEGAL_REQUIRED = [
  'entityName',
  'entityInn',
  'entityRegistration',
  'entityAddress',
  'entityPhone',
  'entityBank',
  'effectiveDate',
] as const satisfies readonly (keyof LegalConfig)[]

/** Required keys that are empty (or, for the date, not YYYY-MM-DD). */
export function missingLegalConfig(cfg: LegalConfig | undefined): string[] {
  return LEGAL_REQUIRED.filter((k) => {
    const v = String(cfg?.[k] ?? '').trim()
    return k === 'effectiveDate' ? !/^\d{4}-\d{2}-\d{2}$/.test(v) : !v
  })
}

/**
 * Documents whose generated text can't be published yet — fail-safe: a
 * count that isn't a number for both languages counts as not ready.
 */
export function docsNotReady(): { doc: LegalDoc; open: number; todo: number }[] {
  const total = (counts: Record<string, number> | undefined) =>
    LOCALES.reduce((sum, l) => sum + (typeof counts?.[l] === 'number' ? counts[l] : Number.POSITIVE_INFINITY), 0)
  return LEGAL_DOCS
    .map((doc) => ({ doc, open: total(META[doc]?.open), todo: total(META[doc]?.todo) }))
    .filter((d) => d.open > 0 || d.todo > 0)
}

/** The full documents are what the site serves (and what people accept). */
export function legalDocsLive(cfg: LegalConfig | undefined): boolean {
  return missingLegalConfig(cfg).length === 0 && docsNotReady().length === 0
}

/** Draft preview of the full documents for the owner — never counts as published. */
export function legalPreview(cfg: LegalConfig | undefined): boolean {
  return cfg?.preview === true || cfg?.preview === 'true'
}

/** Current version of each document; null = not published. */
export function consentVersions(live: boolean): Record<ConsentDoc, string | null> {
  return {
    privacy: live ? META.privacy.version : INTERIM_VERSIONS.privacy,
    terms: live ? META.terms.version : INTERIM_VERSIONS.terms,
    offer: live ? META.offer.version : null,
    guest_licence: GUEST_LICENCE_VERSION,
  }
}

/** Documents each action needs, in the order its checkboxes show them. */
export function requiredConsents(context: ConsentContext, live: boolean): ConsentDoc[] {
  switch (context) {
    case 'lead':
      return ['privacy']
    case 'login':
      return ['terms', 'privacy']
    case 'guest_upload':
      return ['terms', 'guest_licence', 'privacy']
    case 'checkout':
      return [live ? 'offer' : 'terms']
  }
}

/**
 * The i18n keys whose text a person sees when accepting `doc` in
 * `context` — the checkbox (and its link text) or, for the guest
 * licence, the notice above the boxes. The server hashes these
 * strings into the consent record (server/utils/consent.ts), so the
 * record proves the wording itself, not only a version date. Keep in
 * step with the LegalConsentCheckbox keypaths in LeadForm, the login
 * page, the guest page and the event page.
 */
export function consentTextKeys(context: ConsentContext, doc: ConsentDoc, live: boolean): string[] {
  switch (context) {
    case 'lead':
      return ['lead.consent', 'lead.consentLink']
    case 'login':
      return doc === 'terms'
        ? ['couple.consentTerms', live ? 'couple.consentTermsLink' : 'couple.consentTermsLinkInterim']
        : ['couple.consentPrivacy', 'couple.consentPrivacyLink']
    case 'guest_upload':
      if (doc === 'privacy') return ['guest.consent.privacy', 'guest.consent.privacyLink']
      if (doc === 'terms') return ['guest.consent.rules', 'guest.consent.rulesLink']
      return [
        'guest.consent.title',
        'guest.consent.who',
        'guest.consent.storage',
        'guest.consent.storageGeneric',
        'guest.consent.people',
        'guest.consent.changedMind',
        'guest.consent.rules',
        'guest.consent.rulesLink',
      ]
    case 'checkout':
      return live
        ? ['couple.event.offerConsent', 'couple.event.offerLink']
        : ['couple.event.termsConsent', 'couple.event.termsLink']
  }
}

/** { doc: version } for what an action needs — what the client sends as `consent`. */
export function consentPayload(context: ConsentContext, live: boolean): Partial<Record<ConsentDoc, string>> {
  const versions = consentVersions(live)
  return Object.fromEntries(requiredConsents(context, live).map((d) => [d, versions[d]!]))
}

/** A full document as GET /api/legal/[doc] returns it (mode 'interim' = show the short page). */
export interface LegalDocData {
  mode: 'full' | 'preview'
  title: string
  subtitle: string
  toc: { id: string; text: string }[]
  html: string
  version: string | null
  effectiveDate: string | null
}
