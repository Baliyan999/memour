import { describe, expect, it } from 'vitest'
import { generateCode, hashCode, maskPhone, normalizePhone } from '../../server/utils/phone-otp'
import { otpHashMatches } from '../../server/utils/otp-store'

describe('normalizePhone', () => {
  it('accepts the shapes people type and returns +998XXXXXXXXX', () => {
    for (const raw of ['+998 90 123 45 67', '+998901234567', '998901234567', '90 123 45 67', '901234567', '(90) 123-45-67', ' +998-90-123-45-67 ']) {
      expect(normalizePhone(raw), raw).toBe('+998901234567')
    }
  })

  it('keeps a national number that itself starts with 98/99 when the country code is there', () => {
    expect(normalizePhone('+998 99 812 34 56')).toBe('+998998123456')
    expect(normalizePhone('+998 98 123 45 67')).toBe('+998981234567')
  })

  it('refuses numbers of the wrong length', () => {
    for (const raw of ['', '+998', '90 123 45 6', '+998 90 123 45 678', '12345', '+7 912 345 67 89']) {
      expect(normalizePhone(raw), raw).toBeNull()
    }
  })

  it('ignores letters and symbols instead of failing on them', () => {
    expect(normalizePhone('tel: +998 (90) 123-45-67')).toBe('+998901234567')
  })
})

describe('maskPhone', () => {
  it('keeps the operator code and the last four digits only', () => {
    expect(maskPhone('+998901234567')).toBe('+99890***4567')
  })

  it('masks short input completely', () => {
    expect(maskPhone('+99890')).toBe('***')
    expect(maskPhone('')).toBe('***')
  })
})

describe('login codes', () => {
  it('are always six digits, leading zeros included', () => {
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  })

  it('are hashed together with the phone', () => {
    const a = hashCode('+998901234567', '123456')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashCode('+998901234567', '123456')).toBe(a)
    expect(hashCode('+998901234568', '123456')).not.toBe(a)
    expect(hashCode('+998901234567', '123457')).not.toBe(a)
  })

  it('compare only equal, non-empty hashes', () => {
    const h = hashCode('+998901234567', '000001')
    expect(otpHashMatches(h, h)).toBe(true)
    expect(otpHashMatches(h, hashCode('+998901234567', '000002'))).toBe(false)
    expect(otpHashMatches(h, h.slice(0, 32))).toBe(false)
    expect(otpHashMatches('', '')).toBe(false)
    expect(otpHashMatches(h, 'not hex')).toBe(false)
  })
})
