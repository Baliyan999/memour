import { docsNotReady, legalDocsLive, legalPreview, missingLegalConfig, type LegalConfig } from '#shared/legal'

/**
 * Nitro startup plugin that validates the environment (the full list
 * with explanations lives in docs/DEPLOY.md).
 *
 * Two kinds of problems:
 * - fatal — "nothing works" or "unsafe" settings. A built (production)
 *   server refuses to start: a loud crash at deploy time beats a site
 *   that prints localhost into QR codes or fails every DB call.
 * - warnings — a feature is off or degraded (admin login, SMS login,
 *   Telegram alerts, payments); the code behind it fails closed, the
 *   site itself still works.
 *
 * `nuxt dev` reports both as warnings so partial local setups boot.
 */
export default defineNitroPlugin(() => {
  const env = process.env
  const config = useRuntimeConfig()
  const fatal: string[] = []
  const warn: string[] = []

  // --- Site URL: QR codes, magic-link redirects, canonical/hreflang ----
  // Required in the runtime env itself: i18n's baseUrl is expanded from
  // it at startup (nuxt.config), a baked value alone isn't enough.
  const siteUrl = String(config.public.siteUrl ?? '')
  if (!env.NUXT_PUBLIC_SITE_URL) {
    fatal.push('NUXT_PUBLIC_SITE_URL is not set — QR codes and login links would point to localhost')
  } else if (!siteUrl.startsWith('https://')) {
    warn.push(`NUXT_PUBLIC_SITE_URL is not https (${siteUrl}) — fine locally, never in production`)
  }
  if (siteUrl.endsWith('/')) {
    // Every link builder strips it; canonical/hreflang may not.
    warn.push('NUXT_PUBLIC_SITE_URL ends with "/" — drop the trailing slash')
  }

  // --- Supabase --------------------------------------------------------
  const sb = config.public.supabase
  if (!sb?.url) fatal.push('NUXT_PUBLIC_SUPABASE_URL is not set')
  if (!sb?.key) fatal.push('NUXT_PUBLIC_SUPABASE_KEY is not set')
  // Resolved at runtime (nuxt.config); an unexpanded "{{…}}" means the
  // variable wasn't in the environment when the server started.
  const serverKey = String(config.supabase?.secretKey || config.supabase?.serviceKey || '')
  if (!serverKey || serverKey.includes('{{')) {
    fatal.push('NUXT_SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is not set — every server-side DB call would fail')
  }
  const secureCookies = sb?.cookieOptions?.secure !== false
  if (siteUrl.startsWith('https://') && !secureCookies) {
    warn.push('session cookies are not Secure on an https site — set NUXT_PUBLIC_SUPABASE_COOKIE_OPTIONS_SECURE=true (or rebuild with the https NUXT_PUBLIC_SITE_URL)')
  }

  // --- Admin sessions --------------------------------------------------
  // Without a signing secret admin login answers 503 — closed, not open.
  const adminSecret = env.ADMIN_SESSION_SECRET ?? ''
  if (adminSecret.length < 32) {
    warn.push(`ADMIN_SESSION_SECRET is ${adminSecret ? 'shorter than 32 characters' : 'not set'} — admin login is refused; generate one with \`openssl rand -hex 32\``)
  }

  // --- SMS (Eskiz) -----------------------------------------------------
  // 'true' switches to Eskiz' fixed test text, which can't carry the
  // code, so a production server turns SMS login off instead.
  if (env.ESKIZ_USE_TEST_TEMPLATE === 'true') {
    warn.push('ESKIZ_USE_TEST_TEMPLATE=true — SMS login is off until the Memour template is approved and this is unset (or false)')
  }
  if (!env.ESKIZ_EMAIL || !env.ESKIZ_PASSWORD) {
    warn.push('ESKIZ_EMAIL / ESKIZ_PASSWORD are not set — couples cannot log in by SMS')
  }

  // --- Telegram --------------------------------------------------------
  if (!env.TELEGRAM_BOT_TOKEN) {
    warn.push('TELEGRAM_BOT_TOKEN is not set — admin login codes and lead alerts cannot be delivered')
  }
  if (!env.TELEGRAM_LEAD_CHAT_ID) {
    warn.push('TELEGRAM_LEAD_CHAT_ID is not set — new leads reach the DB but nobody is notified')
  }

  // --- Payments --------------------------------------------------------
  // A provider is either fully configured or not at all; half a config
  // is a typo, and older checkout code treated it as "dev: mark paid".
  const providers = {
    Payme: ['PAYME_MERCHANT_ID', 'PAYME_MERCHANT_KEY'],
    Click: ['CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET_KEY'],
  }
  let configured = 0
  for (const [name, keys] of Object.entries(providers)) {
    const missing = keys.filter((k) => !env[k])
    if (missing.length === 0) configured++
    else if (missing.length < keys.length) {
      fatal.push(`${name} is half-configured, missing: ${missing.join(', ')}`)
    }
  }
  if (configured === 0) {
    warn.push('no payment provider configured (Payme or Click) — checkout cannot take payments')
  }
  // Payme's receipt line (tax rules): without all three the webhook
  // answers CheckPerformTransaction without `detail`.
  if (env.PAYME_MERCHANT_KEY && !(env.PAYME_IKPU_CODE && env.PAYME_PACKAGE_CODE && env.PAYME_VAT_PERCENT)) {
    warn.push('Payme fiscal details are not set — set PAYME_IKPU_CODE, PAYME_PACKAGE_CODE and PAYME_VAT_PERCENT')
  }

  // --- Legal documents -------------------------------------------------
  // Full privacy policy / terms / public offer need the operator's
  // details and drafts with nothing left to do (shared/legal.ts);
  // until then the short interim pages are served and checkout refers
  // to the terms instead of an offer.
  const legal = (config.public.legal ?? {}) as LegalConfig
  if (!legalDocsLive(legal)) {
    const missing = missingLegalConfig(legal).map((k) => `NUXT_PUBLIC_LEGAL_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
    const notReady = docsNotReady()
    warn.push(
      'legal documents are not published — the short interim /privacy and /terms are served'
      + (missing.length ? `; set ${missing.join(', ')}${missing.includes('NUXT_PUBLIC_LEGAL_EFFECTIVE_DATE') ? ' (date as YYYY-MM-DD)' : ''}` : '')
      + (notReady.length
        ? `; in the drafts, fill the open placeholders and resolve the todo items (owner notes, dangling references) listed by scripts/legal-publish.mjs, then re-run it: ${notReady.map((d) => `${d.doc}: ${Number.isFinite(d.open) ? d.open : '?'} open, ${Number.isFinite(d.todo) ? d.todo : '? (count missing)'} todo`).join('; ')} (uz + ru)`
        : ''),
    )
    if (configured > 0) {
      warn.push('payments are on but no public offer is published — checkout asks to accept the interim terms instead')
    }
  }
  if (legalPreview(legal)) {
    warn.push('NUXT_PUBLIC_LEGAL_PREVIEW is on — unpublished legal drafts are visible to everyone; never on the production server')
  }

  // --- Retention -------------------------------------------------------
  // The privacy page and Pricing say media are deleted 180 days after
  // the wedding (365 for Luxury); only the purge task makes that true.
  if (env.RETENTION_PURGE_ENABLED !== 'true') {
    warn.push('RETENTION_PURGE_ENABLED is not true — expired weddings are only listed, not deleted, while the privacy page, Pricing, the guest screen and checkout say they are; required in production: enable it right after the first [retention] dry run looks right (docs/DEPLOY.md §8)')
  }

  // --- Report ----------------------------------------------------------
  const production = !import.meta.dev
  const blocking = production ? fatal : []
  const notes = production ? warn : [...fatal, ...warn]

  for (const n of notes) console.warn(`[memour] WARN: ${n}`)
  if (blocking.length > 0) {
    console.error('━'.repeat(60))
    console.error('[memour] FATAL: refusing to start, fix the environment first:')
    for (const f of blocking) console.error(`  - ${f}`)
    console.error('See docs/DEPLOY.md → "Environment".')
    console.error('━'.repeat(60))
    throw new Error(`[memour] env check failed: ${blocking.length} fatal problem(s)`)
  }

  if (notes.length === 0) console.log('[memour] env check passed.')
  else console.warn(`[memour] env check: ${notes.length} warning(s), see above.`)
})
