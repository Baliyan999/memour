import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONSENT_CONTEXTS,
  GUEST_LICENCE_VERSION,
  INTERIM_VERSIONS,
  LEGAL_REQUIRED,
  consentPayload,
  consentTextKeys,
  consentVersions,
  docsNotReady,
  legalDocsLive,
  legalPreview,
  missingLegalConfig,
  requiredConsents,
  type LegalConfig,
} from '#shared/legal'
import meta from '../../shared/legal-meta.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'

const FULL: LegalConfig = {
  entityName: 'Memour MCHJ',
  entityInn: '123456789',
  entityRegistration: 'reg',
  entityAddress: 'Tashkent',
  entityPhone: '+998 90 000 00 00',
  entityBank: 'bank',
  effectiveDate: '2026-12-01',
}

describe('missingLegalConfig', () => {
  it('lists every required detail when nothing is configured', () => {
    expect(missingLegalConfig(undefined)).toEqual([...LEGAL_REQUIRED])
    expect(missingLegalConfig({})).toEqual([...LEGAL_REQUIRED])
  })

  it('is empty for a complete config', () => {
    expect(missingLegalConfig(FULL)).toEqual([])
  })

  it('counts whitespace as missing', () => {
    expect(missingLegalConfig({ ...FULL, entityInn: '   ' })).toEqual(['entityInn'])
  })

  it('wants the effective date as YYYY-MM-DD', () => {
    for (const d of ['01.12.2026', '2026-12-1', 'soon', '2026-12-01T00:00']) {
      expect(missingLegalConfig({ ...FULL, effectiveDate: d })).toEqual(['effectiveDate'])
    }
  })
})

describe('legalPreview', () => {
  it('is on only for true or "true"', () => {
    expect(legalPreview({ preview: true })).toBe(true)
    expect(legalPreview({ preview: 'true' })).toBe(true)
    for (const p of [false, 'false', '1', 'yes', undefined]) expect(legalPreview({ preview: p as never })).toBe(false)
    expect(legalPreview(undefined)).toBe(false)
  })
})

describe('publishing gate', () => {
  afterEach(() => {
    vi.doUnmock('../../shared/legal-meta.json')
    vi.resetModules()
  })

  it('keeps the full documents off while the generated texts have open items', () => {
    const blocked = docsNotReady().map((d) => d.doc)
    const withOpenItems = (Object.keys(meta) as (keyof typeof meta)[]).filter(
      (d) => meta[d].open.uz + meta[d].open.ru + meta[d].todo.uz + meta[d].todo.ru > 0,
    )
    expect(blocked).toEqual(withOpenItems)
    if (withOpenItems.length) expect(legalDocsLive(FULL)).toBe(false)
  })

  const clean = { version: 'v', sha256: 'x', open: { uz: 0, ru: 0 }, todo: { uz: 0, ru: 0 } }

  it('goes live only with every detail configured and nothing left to do', async () => {
    vi.doMock('../../shared/legal-meta.json', () => ({ default: { privacy: clean, terms: clean, offer: clean } }))
    vi.resetModules()
    const legal = await import('#shared/legal')
    expect(legal.docsNotReady()).toEqual([])
    expect(legal.legalDocsLive(FULL)).toBe(true)
    expect(legal.legalDocsLive({ ...FULL, entityBank: '' })).toBe(false)
  })

  it('treats a missing count as not ready (fail-safe)', async () => {
    const noTodoRu = { ...clean, todo: { uz: 0 } }
    vi.doMock('../../shared/legal-meta.json', () => ({ default: { privacy: clean, terms: noTodoRu, offer: clean } }))
    vi.resetModules()
    const legal = await import('#shared/legal')
    expect(legal.docsNotReady()).toEqual([{ doc: 'terms', open: 0, todo: Number.POSITIVE_INFINITY }])
    expect(legal.legalDocsLive(FULL)).toBe(false)
  })
})

describe('consent versions', () => {
  it('interim: the short pages, no offer yet', () => {
    expect(consentVersions(false)).toEqual({
      privacy: INTERIM_VERSIONS.privacy,
      terms: INTERIM_VERSIONS.terms,
      offer: null,
      guest_licence: GUEST_LICENCE_VERSION,
    })
  })

  it('live: the generated documents', () => {
    expect(consentVersions(true)).toEqual({
      privacy: meta.privacy.version,
      terms: meta.terms.version,
      offer: meta.offer.version,
      guest_licence: GUEST_LICENCE_VERSION,
    })
  })

  it('an interim version can never equal a full one', () => {
    for (const v of Object.values(INTERIM_VERSIONS)) expect(v.startsWith('interim-')).toBe(true)
  })
})

describe('required consents', () => {
  it('per action', () => {
    expect(requiredConsents('lead', false)).toEqual(['privacy'])
    expect(requiredConsents('login', false)).toEqual(['terms', 'privacy'])
    expect(requiredConsents('guest_upload', false)).toEqual(['terms', 'guest_licence', 'privacy'])
  })

  it('checkout asks for the offer once it is published, the terms until then', () => {
    expect(requiredConsents('checkout', true)).toEqual(['offer'])
    expect(requiredConsents('checkout', false)).toEqual(['terms'])
  })

  it('the payload carries a version for every required document', () => {
    expect(consentPayload('guest_upload', false)).toEqual({
      terms: INTERIM_VERSIONS.terms,
      guest_licence: GUEST_LICENCE_VERSION,
      privacy: INTERIM_VERSIONS.privacy,
    })
    for (const ctx of CONSENT_CONTEXTS) {
      for (const live of [true, false]) {
        const payload = consentPayload(ctx, live)
        expect(Object.keys(payload)).toEqual(requiredConsents(ctx, live))
        for (const v of Object.values(payload)) expect(v).toBeTruthy()
      }
    }
  })
})

describe('consent wording keys', () => {
  // The server hashes these strings into every consent record; a key
  // that doesn't exist would silently hash `null` instead of the text.
  const lookup = (messages: unknown, key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages)

  for (const ctx of CONSENT_CONTEXTS) {
    for (const live of [true, false]) {
      it(`${ctx} (${live ? 'full documents' : 'interim'}) exist in uz and ru`, () => {
        for (const doc of requiredConsents(ctx, live)) {
          const keys = consentTextKeys(ctx, doc, live)
          expect(keys.length).toBeGreaterThan(0)
          for (const key of keys) {
            expect(typeof lookup(uz, key), `uz ${key}`).toBe('string')
            expect(typeof lookup(ru, key), `ru ${key}`).toBe('string')
          }
        }
      })
    }
  }
})
