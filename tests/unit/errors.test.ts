import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fail, failZod } from '../../server/utils/errors'

function thrown(fn: () => unknown): any {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('expected a throw')
}

describe('fail', () => {
  it('puts the code in statusMessage and data.code', () => {
    const e = thrown(() => fail(404, 'event_not_found'))
    expect(e.statusCode).toBe(404)
    expect(e.statusMessage).toBe('event_not_found')
    expect(e.data).toEqual({ code: 'event_not_found' })
  })

  it('carries the field and the placeholder values', () => {
    const e = thrown(() => fail(422, 'guests_out_of_range', { field: 'guests_estimate', params: { min: 10, max: 5000 } }))
    expect(e.data).toEqual({ code: 'guests_out_of_range', field: 'guests_estimate', params: { min: 10, max: 5000 } })
  })
})

describe('failZod', () => {
  const lead = z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().max(32),
    guests: z.number().int().min(10).max(5000).optional(),
    note: z.string().max(5).optional(),
  })
  const MAP = {
    name: { too_big: 'name_too_long', '*': 'name_too_short' },
    phone: 'invalid_phone',
    guests: 'guests_out_of_range',
  }
  const fromZod = (input: unknown, map = MAP, fallback?: string) => {
    const r = lead.safeParse(input)
    if (r.success) throw new Error('expected the parse to fail')
    return thrown(() => failZod(r.error, map, fallback))
  }

  it('answers 422 with the code mapped to the issue code', () => {
    const e = fromZod({ name: 'x'.repeat(81), phone: '1' })
    expect(e.statusCode).toBe(422)
    expect(e.data).toEqual({ code: 'name_too_long', field: 'name', params: { max: 80 } })
  })

  it('uses "*" for any other issue on that field', () => {
    expect(fromZod({ name: 'A', phone: '1' }).data).toEqual({ code: 'name_too_short', field: 'name', params: { min: 2 } })
    expect(fromZod({ name: 42, phone: '1' }).data).toEqual({ code: 'name_too_short', field: 'name' })
  })

  it('maps a plain string rule whatever the issue', () => {
    expect(fromZod({ name: 'Ali', phone: 7 }).data).toEqual({ code: 'invalid_phone', field: 'phone' })
    expect(fromZod({ name: 'Ali', phone: 'x'.repeat(33) }).data).toEqual({ code: 'invalid_phone', field: 'phone', params: { max: 32 } })
  })

  it('fills {min} / {max} from numeric bounds', () => {
    expect(fromZod({ name: 'Ali', phone: '1', guests: 3 }).data).toEqual({ code: 'guests_out_of_range', field: 'guests', params: { min: 10 } })
    expect(fromZod({ name: 'Ali', phone: '1', guests: 9000 }).data).toEqual({ code: 'guests_out_of_range', field: 'guests', params: { max: 5000 } })
  })

  it('skips issues on fields the map does not name and reports the first one it does', () => {
    const e = fromZod({ name: 'Ali', phone: 7, note: 'too long' })
    expect(e.data).toEqual({ code: 'invalid_phone', field: 'phone' })
  })

  it('falls back to invalid_input (or the given code) for unmapped issues', () => {
    expect(fromZod({ name: 'Ali', phone: '1', note: 'too long' }).data).toEqual({ code: 'invalid_input' })
    expect(fromZod({ name: 'Ali', phone: '1', note: 'too long' }, MAP, 'invalid_email').data).toEqual({ code: 'invalid_email' })
    expect(fromZod(null).data).toEqual({ code: 'invalid_input' })
  })

  it('keys nested issues by their top-level field', () => {
    const schema = z.object({ consent: z.record(z.string(), z.string().max(3)) })
    const r = schema.safeParse({ consent: { privacy: 'too-long-version' } })
    const e = thrown(() => failZod(r.error!, { consent: 'consent_required' }))
    expect(e.data).toEqual({ code: 'consent_required', field: 'consent', params: { max: 3 } })
  })

  it("never lets zod's own English text out", () => {
    const r = lead.safeParse({ name: 'A', phone: 7, guests: 1.5 })
    const zodMessages = r.error!.issues.map((i) => i.message)
    expect(zodMessages.length).toBeGreaterThan(0)
    const e = thrown(() => failZod(r.error!, MAP))
    const wire = JSON.stringify({ statusMessage: e.statusMessage, message: e.message, data: e.data })
    for (const m of zodMessages) expect(wire).not.toContain(m)
    expect(e.statusMessage).toMatch(/^[a-z][a-z0-9_]+$/)
  })
})
