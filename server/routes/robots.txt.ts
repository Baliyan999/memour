/**
 * /robots.txt — served from a route (not public/) so the Sitemap line
 * can be an absolute URL built from siteUrl, as the protocol requires.
 *
 * Every real page lives under /uz or /ru, so private areas are listed
 * per locale; the unprefixed forms stay for old links. The pages
 * themselves also send `X-Robots-Tag: noindex` (nuxt.config).
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const site = String(config.public.siteUrl ?? '').replace(/\/+$/, '')
  const locales = ['uz', 'ru']
  const privatePaths = ['/e/', '/dashboard', '/admin']

  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    ...locales.flatMap((l) => privatePaths.map((p) => `Disallow: /${l}${p}`)),
    ...privatePaths.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ]

  setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
