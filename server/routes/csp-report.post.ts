/**
 * POST /csp-report — sink for the Content-Security-Policy-Report-Only
 * header (nuxt.config). Logs one compact line per violation so we can
 * see what the policy would block before switching it to enforcing.
 *
 * Bounded so a noisy page (or someone with curl) can't flood the logs
 * or the memory: browsers send small JSON with a Content-Length, so
 * anything bigger — or without one — is dropped before its body is
 * read, and at most LOG_BUDGET reports per minute are logged in total.
 * A shared budget rather than a per-IP limiter: it's a diagnostics
 * sink, and utils/rate-limit prunes every bucket with the caller's
 * window, so calling it from a public endpoint would reset real
 * limits elsewhere.
 */
const MAX_BYTES = 8192
const LOG_BUDGET = 60
let budgetStart = 0
let budgetUsed = 0

export default defineEventHandler(async (event) => {
  setResponseStatus(event, 204)

  const length = Number(getRequestHeader(event, 'content-length'))
  if (!(length > 0 && length <= MAX_BYTES)) return null

  const now = Date.now()
  if (now - budgetStart >= 60_000) {
    budgetStart = now
    budgetUsed = 0
  }
  if (budgetUsed >= LOG_BUDGET) return null
  budgetUsed++

  const raw = await readRawBody(event).catch(() => undefined)
  if (!raw || raw.length > MAX_BYTES) return null
  try {
    const body = JSON.parse(raw)
    const r = body?.['csp-report'] ?? body?.[0]?.body ?? body
    console.warn(
      '[csp] would block',
      JSON.stringify({
        directive: r?.['violated-directive'] ?? r?.effectiveDirective,
        blocked: r?.['blocked-uri'] ?? r?.blockedURL,
        page: r?.['document-uri'] ?? r?.documentURL,
      }),
    )
  } catch { /* not JSON — ignore */ }
  return null
})
