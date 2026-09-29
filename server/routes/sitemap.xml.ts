import { legalDocsLive, type LegalConfig } from '#shared/legal'

/**
 * /sitemap.xml — the public pages in both locales, each with its
 * hreflang alternates (and x-default → uz, the default locale) so
 * search engines treat /uz/… and /ru/… as translations of one page.
 * The hreflang codes match the `language` of each locale in
 * nuxt.config, i.e. what useLocaleHead puts in the <head>.
 */
const LOCALES = [
  { code: 'uz', hreflang: 'uz-UZ' },
  { code: 'ru', hreflang: 'ru-RU' },
] as const
const DEFAULT_LOCALE = 'uz'

const PAGES = [
  { path: '', changefreq: 'weekly', priority: '1.0' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { path: '/terms', changefreq: 'yearly', priority: '0.3' },
]
// Only once the full documents are published (shared/legal.ts).
const OFFER = { path: '/offer', changefreq: 'yearly', priority: '0.3' }

export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const site = String(config.public.siteUrl ?? 'http://localhost:3000').replace(/\/+$/, '')

  const live = legalDocsLive((config.public.legal ?? {}) as LegalConfig)
  const urls = (live ? [...PAGES, OFFER] : PAGES).flatMap((page) => {
    const href = (code: string) => `${site}/${code}${page.path}`
    const alternates = [
      ...LOCALES.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.hreflang}" href="${href(l.code)}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${href(DEFAULT_LOCALE)}"/>`,
    ].join('\n')
    return LOCALES.map(
      (l) => `  <url>
    <loc>${href(l.code)}</loc>
${alternates}
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
    )
  }).join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls}
</urlset>`
})
