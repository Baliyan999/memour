/**
 * The one way a failure becomes text on the screen, in the site's
 * language.
 *
 * Every endpoint answers errors with a stable snake_case code in
 * `data.code` (server/utils/errors.ts, server/error.ts). This turns
 * whatever a catch block got — a $fetch error, an upload result, a
 * thrown { code }, a bare code string — into that code, and the code
 * into t(): scope- and variant-specific wording first, then the shared
 * `errors.<code>`, then a generic line. No answer at all is the
 * network line, a 5xx without a code the "server" line.
 *
 * Raw text — e.message, statusMessage, Supabase / zod / browser
 * messages, HTTP status text — never reaches the screen.
 *
 *   const errorMessage = useErrorMessage('couple')
 *   try { … } catch (e) { toast.error(errorMessage(e)) }
 *   errorMessage(e, { variant: 'cover' })   // errors.file_too_large_cover
 */
import { useI18n } from '#imports'

export interface ErrorInfo {
  code: string
  status: number
  field?: string
  params?: Record<string, unknown>
}

export type ErrorScope = 'couple' | 'guest' | 'lead' | 'admin.login'

export interface ErrorMessageOptions {
  /** Tried before the plain code: errors.<code>_<variant> (photo, cover, logo…). */
  variant?: string
  /** Values for the text's placeholders, on top of the server's own. */
  params?: Record<string, unknown>
  /** Key used when no text exists for the code (default errors.generic). */
  fallback?: string
}

const CODE_RE = /^[a-z][a-z0-9_]{1,63}$/

const CODE_BY_STATUS: Record<number, string> = {
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  410: 'not_found',
  413: 'file_too_large',
  415: 'unsupported_mime',
  422: 'invalid_input',
  429: 'rate_limited',
}

/** fetch() / supabase-js / ofetch wording for "the request never got an answer". */
const NO_ANSWER_RE = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i

export function errorInfo(e: unknown): ErrorInfo {
  if (typeof e === 'string') return { code: CODE_RE.test(e) ? e : 'generic', status: 0 }
  const x = e as any
  const status = Number(x?.statusCode ?? x?.status ?? x?.response?.status ?? 0) || 0
  // $fetch → x.data.data; our { statusCode, data } shape → x.data; thrown { code } → x
  for (const p of [x?.data?.data, x?.data, x]) {
    if (typeof p?.code === 'string' && CODE_RE.test(p.code)) {
      return { code: p.code, status, field: p.field, params: p.params }
    }
  }
  if (!status) {
    if (x?.name === 'AbortError') return { code: 'aborted', status }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    const noAnswer = offline || x?.name === 'FetchError' || x?.name === 'AuthRetryableFetchError'
      || NO_ANSWER_RE.test(String(x?.message ?? ''))
    return { code: noAnswer ? 'network' : 'generic', status }
  }
  if (status >= 500) return { code: 'server_error', status }
  return { code: CODE_BY_STATUS[status] ?? 'generic', status }
}

type Translate = (key: string, params?: Record<string, unknown>) => string
type Exists = (key: string) => boolean

/** Plain-function core, for places without a component (plugins). */
export function errorText(
  t: Translate,
  te: Exists,
  e: unknown,
  scope?: ErrorScope,
  opts: ErrorMessageOptions = {},
): string {
  const info = errorInfo(e)
  const params = { ...info.params, ...opts.params }
  const keys = [
    scope && opts.variant && `${scope}.errors.${info.code}_${opts.variant}`,
    scope && `${scope}.errors.${info.code}`,
    opts.variant && `errors.${info.code}_${opts.variant}`,
    `errors.${info.code}`,
  ]
  for (const k of keys) if (k && te(k)) return t(k, params)
  if (import.meta.dev) console.warn(`[errors] no text for code "${info.code}"`)
  return t(opts.fallback ?? (info.status >= 500 ? 'errors.server_error' : 'errors.generic'))
}

export function useErrorMessage(scope?: ErrorScope) {
  const { t, te } = useI18n()
  return (e: unknown, opts: ErrorMessageOptions = {}): string =>
    errorText(t as Translate, te, e, scope, opts)
}
