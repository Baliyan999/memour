import { LEGAL_DOCS, consentVersions, type LegalConfig, type LegalDoc } from '#shared/legal'
import { getLegalDoc } from '../../utils/legal-docs'
import { fail } from '../../utils/errors'

/**
 * GET /api/legal/[doc]?locale=uz|ru — the full text of privacy, terms or
 * offer for its page, or { mode: 'interim' } while the full documents
 * can't be published yet (shared/legal.ts): the page then shows its
 * short interim text (/offer sends people to the terms).
 *
 * mode 'preview' = the drafts shown to the owner under
 * NUXT_PUBLIC_LEGAL_PREVIEW; the page marks them as not published.
 */
export default defineEventHandler(async (event) => {
  const doc = getRouterParam(event, 'doc') as LegalDoc
  if (!LEGAL_DOCS.includes(doc)) fail(404, 'not_found')
  const locale = getQuery(event).locale === 'ru' ? 'ru' : 'uz'

  const full = await getLegalDoc(doc, locale)
  if (!full) return { mode: 'interim' as const }

  const cfg = (useRuntimeConfig().public.legal ?? {}) as LegalConfig
  return {
    mode: full.preview ? ('preview' as const) : ('full' as const),
    title: full.title,
    subtitle: full.subtitle,
    toc: full.toc,
    html: full.html,
    version: consentVersions(true)[doc],
    effectiveDate: cfg.effectiveDate || null,
  }
})
