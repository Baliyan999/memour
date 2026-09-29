import { useLocalePath, useRuntimeConfig } from '#imports'
import { consentPayload, legalDocsLive, type ConsentContext, type LegalConfig } from '#shared/legal'

/**
 * What the site serves as its legal texts right now (shared/legal.ts)
 * and what a form sends as `consent`.
 *
 *   const { consentFor, salesTermsPath } = useLegal()
 *   $fetch('/api/lead', { body: { …, consent: consentFor('lead') } })
 */
export function useLegal() {
  const live = legalDocsLive(useRuntimeConfig().public.legal as LegalConfig)
  const localePath = useLocalePath()
  return {
    /** The full documents are published (else the short interim pages). */
    live,
    /** { doc: version } of the texts an action needs. */
    consentFor: (context: ConsentContext) => consentPayload(context, live),
    /** Terms of sale: the public offer, or the terms' refund section until an offer is published. */
    salesTermsPath: () => (live ? localePath('/offer') : `${localePath('/terms')}#refund`),
  }
}
