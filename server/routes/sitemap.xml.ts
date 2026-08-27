/**
 * /sitemap.xml — emits a basic sitemap covering the localized landing
 * page URLs. Mirrors the Next.js sitemap.ts: one entry per locale,
 * weekly change frequency, top priority. More routes can be added as
 * we port additional pages.
 */
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const site = (config.public.siteUrl as string | undefined) ?? 'http://localhost:3000'
  const locales = ['ru', 'uz'] as const
  const now = new Date().toISOString()

  const urls = locales
    .map(
      locale => `  <url>
    <loc>${site}/${locale}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`,
    )
    .join('\n')

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`
})
