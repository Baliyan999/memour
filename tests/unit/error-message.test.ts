import { describe, expect, it } from 'vitest'
import { errorInfo, errorText } from '~/composables/useErrorMessage'
import uz from '../../i18n/locales/uz.json'

/**
 * The client half of the error contract (server/utils/errors.ts is the
 * other): whatever a catch block gets becomes a code, the code becomes
 * a translated line, and raw server / browser text never reaches the
 * screen.
 */
const lookup = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], uz)
const te = (key: string) => typeof lookup(key) === 'string'
const t = (key: string, params: Record<string, unknown> = {}) =>
  String(lookup(key)).replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))

describe('errorInfo', () => {
  it('reads the code from a $fetch error (data.data)', () => {
    const e = { statusCode: 422, data: { statusMessage: 'invalid_phone', data: { code: 'invalid_phone', field: 'phone' } } }
    expect(errorInfo(e)).toEqual({ code: 'invalid_phone', status: 422, field: 'phone', params: undefined })
  })

  it('reads our { statusCode, data } shape, a thrown { code } and a bare code', () => {
    expect(errorInfo({ statusCode: 409, data: { code: 'wrong_table' } }).code).toBe('wrong_table')
    expect(errorInfo({ code: 'quota_exceeded' }).code).toBe('quota_exceeded')
    expect(errorInfo('event_not_active')).toEqual({ code: 'event_not_active', status: 0 })
  })

  it('carries the params of the translated text', () => {
    const e = { statusCode: 429, data: { data: { code: 'email_resend_wait', params: { sec: 42 } } } }
    expect(errorInfo(e).params).toEqual({ sec: 42 })
  })

  it('refuses anything that is not a snake_case code', () => {
    expect(errorInfo('Something went wrong').code).toBe('generic')
    expect(errorInfo({ statusCode: 400, data: { code: 'Bad Request' } }).code).toBe('generic')
    expect(errorInfo({ statusCode: 400, data: { code: 'x' } }).code).toBe('generic')
    expect(errorInfo({ statusCode: 500, data: { code: '<script>' } }).code).toBe('server_error')
  })

  it('maps a request that never got an answer to network / aborted', () => {
    expect(errorInfo(new TypeError('Failed to fetch')).code).toBe('network')
    expect(errorInfo(new TypeError('Load failed')).code).toBe('network')
    expect(errorInfo({ name: 'FetchError', message: '[POST] "/api/lead": <no response>' }).code).toBe('network')
    expect(errorInfo(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })).code).toBe('aborted')
    expect(errorInfo(new Error('boom')).code).toBe('generic')
  })

  it('falls back to the status when the server sent no code', () => {
    expect(errorInfo({ statusCode: 502, statusMessage: 'Bad Gateway' }).code).toBe('server_error')
    expect(errorInfo({ status: 413 }).code).toBe('file_too_large')
    expect(errorInfo({ response: { status: 429 } }).code).toBe('rate_limited')
    expect(errorInfo({ statusCode: 418 }).code).toBe('generic')
  })
})

describe('errorText', () => {
  it('translates the code', () => {
    expect(errorText(t, te, { statusCode: 422, data: { data: { code: 'invalid_phone' } } })).toBe(uz.errors.invalid_phone)
  })

  it('prefers scope- and variant-specific wording', () => {
    // guest.errors.permission_denied_mic exists; guest.errors.permission_denied is the plain one.
    expect(errorText(t, te, 'permission_denied', 'guest', { variant: 'mic' })).toBe(uz.guest.errors.permission_denied_mic)
    expect(errorText(t, te, 'permission_denied', 'guest')).toBe(uz.guest.errors.permission_denied)
  })

  it('fills placeholders from the server params', () => {
    const text = errorText(t, te, { statusCode: 422, data: { data: { code: 'guests_out_of_range', params: { min: 10, max: 5000 } } } })
    expect(text).toContain('10')
    expect(text).toContain('5000')
    expect(text).not.toMatch(/\{(min|max)\}/)
  })

  it('shows the generic line for an unknown code and the server line for an unknown 5xx', () => {
    expect(errorText(t, te, 'no_such_code_anywhere')).toBe(uz.errors.generic)
    expect(errorText(t, te, { statusCode: 503, data: { data: { code: 'no_such_code_anywhere' } } })).toBe(uz.errors.server_error)
  })

  it('never shows the raw message, status text or code', () => {
    const raw = {
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: 'relation "public.events" does not exist',
      data: { message: 'ZodError: Expected string, received number' },
    }
    const text = errorText(t, te, raw)
    expect(text).toBe(uz.errors.server_error)
    for (const leak of ['Internal Server Error', 'relation', 'ZodError', '500']) expect(text).not.toContain(leak)
  })
})
