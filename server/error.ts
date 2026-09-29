import type { H3Event } from 'h3'

/**
 * Error handler for /api/** — runs before Nuxt's own (which renders
 * app/error.vue for pages). Registered from nuxt.config ('nitro:config').
 *
 * 1. Every API error answers with a stable code, whatever threw it:
 *    fail() codes pass through; anything else — h3's "Invalid JSON
 *    body", an unknown /api path, an exception nobody caught — becomes
 *    a code by its status (server_error for 5xx) and is logged here.
 *    No English text (h3, zod, Supabase, Node) reaches the client.
 *
 * 2. A browser tab that opened an /api link directly (the couple's
 *    photo link, a ZIP or QR PDF URL, a bookmarked or shared link) is
 *    never left on a raw error page in the default language: it's sent
 *    to the matching page of the site in the visitor's language with
 *    ?err=<code>, which app/plugins/error-query.client.ts shows as a
 *    toast. Session expired → that area's login page.
 *
 * Everything else (images, fetch/$fetch, XHR) keeps getting JSON.
 */
const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CODE_BY_STATUS: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'not_found',
  413: 'file_too_large',
  415: 'unsupported_mime',
  422: 'invalid_input',
  429: 'rate_limited',
}

function codeOf(error: { statusCode?: number; data?: any }): string {
  const code = error.data?.code
  if (typeof code === 'string' && CODE_RE.test(code)) return code
  const status = error.statusCode || 500
  return status >= 500 ? 'server_error' : CODE_BY_STATUS[status] ?? 'invalid_input'
}

/**
 * A top-level page load (link click, typed URL) — not fetch / <img>.
 * Accept is what tells them apart: SSR's own $fetch to /api forwards
 * the page request's headers (sec-fetch-dest: document included) but
 * never its Accept.
 */
function opensAsPage(event: H3Event): boolean {
  if (event.method !== 'GET' && event.method !== 'HEAD') return false
  if (!(getRequestHeader(event, 'accept') ?? '').includes('text/html')) return false
  const dest = getRequestHeader(event, 'sec-fetch-dest')
  return !dest || dest === 'document'
}

/** The site language the visitor was using: ?lang, the page they came from, the i18n cookie, the browser. */
function visitorLocale(event: H3Event): 'uz' | 'ru' {
  const q = getQuery(event).lang
  if (q === 'uz' || q === 'ru') return q
  const from = /^https?:\/\/[^/]+\/(uz|ru)(?:[/?#]|$)/.exec(getRequestHeader(event, 'referer') ?? '')?.[1]
  if (from === 'uz' || from === 'ru') return from
  const cookie = getCookie(event, 'i18n_redirected')
  if (cookie === 'uz' || cookie === 'ru') return cookie
  return /^\s*ru\b/i.test(getRequestHeader(event, 'accept-language') ?? '') ? 'ru' : 'uz'
}

/** Where a failed /api link sends the tab: the page the link belongs to. */
function pageFor(path: string, status: number, lang: 'uz' | 'ru'): string {
  const [, , area, kind] = path.split('/')
  const id = path.split('/').find((s) => UUID_RE.test(s))
  if (area === 'admin' || area === 'admin-auth') {
    return status === 401 || status === 403 ? `/${lang}/admin/login` : `/${lang}/admin`
  }
  if (area === 'couple' || area === 'checkout') {
    if (status === 401) return `/${lang}/dashboard/login`
    if (id && (kind === 'zip' || kind === 'qr-pdf' || kind === 'event')) return `/${lang}/dashboard/event/${id}`
    return `/${lang}/dashboard`
  }
  return `/${lang}`
}

export default defineNitroErrorHandler((error, event) => {
  const path = event.path.split('?')[0] ?? ''
  if (event.handled || !path.startsWith('/api/')) return // pages: Nuxt's error.vue

  const status = error.statusCode || 500
  const code = codeOf(error)
  const data = error.data as Record<string, unknown> | undefined
  if (error.unhandled || error.fatal || (status >= 500 && typeof data?.code !== 'string')) {
    console.error(`[api] ${event.method} ${path} → ${status} ${code}`, error.cause ?? error)
  }

  if (opensAsPage(event)) {
    const to = `${pageFor(path, status, visitorLocale(event))}?err=${code}`
    return sendRedirect(event, to, 303)
  }

  const extra = data && typeof data === 'object' && data.code === code ? data : {}
  setResponseHeaders(event, {
    'content-type': 'application/json',
    'x-content-type-options': 'nosniff',
    'cache-control': getResponseHeader(event, 'cache-control') ?? 'no-cache',
  })
  setResponseStatus(event, status, code)
  return send(event, JSON.stringify({
    error: true,
    statusCode: status,
    statusMessage: code,
    message: code,
    data: { ...extra, code },
  }))
})
