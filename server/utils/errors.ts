import type { ZodError } from 'zod'

/**
 * Error contract of every endpoint: the HTTP status plus a stable
 * snake_case code in `statusMessage` and `data.code`. Pages turn the
 * code into t('errors.<code>') (or a more specific key); raw server or
 * Supabase text never reaches the screen.
 *
 *   if (!ev) fail(404, 'event_not_found')
 *   fail(422, 'guests_out_of_range', { field: 'guests_estimate', params: { min: 10, max: 5000 } })
 *
 * `field` names the form field the code belongs to, `params` fills the
 * placeholders of the translated text ({min}, {max}, {sec}…).
 */
export interface FailExtra {
  field?: string
  params?: Record<string, string | number>
}

export function fail(statusCode: number, code: string, extra: FailExtra = {}): never {
  throw createError({ statusCode, statusMessage: code, data: { code, ...extra } })
}

type IssueCode = ZodError['issues'][number]['code']
/** field → code, or field → { issue code → code, '*' → any other issue }. */
export type ZodCodeMap = Record<string, string | Partial<Record<IssueCode | '*', string>>>

/**
 * A failed zod parse → 422 with the first issue that has a code in
 * `map` (plus its field and min / max). Anything else is `fallback`.
 * Zod's own English message never leaves the server.
 *
 *   if (!parsed.success) failZod(parsed.error, {
 *     name: { too_big: 'name_too_long', '*': 'name_too_short' },
 *     phone: 'invalid_phone',
 *   })
 */
export function failZod(error: ZodError, map: ZodCodeMap = {}, fallback = 'invalid_input'): never {
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '')
    const rule = map[field]
    const code = typeof rule === 'string' ? rule : rule?.[issue.code] ?? rule?.['*']
    if (!code) continue
    const params: Record<string, number> = {}
    if ('minimum' in issue && typeof issue.minimum === 'number') params.min = issue.minimum
    if ('maximum' in issue && typeof issue.maximum === 'number') params.max = issue.maximum
    fail(422, code, Object.keys(params).length ? { field, params } : { field })
  }
  fail(422, fallback)
}
