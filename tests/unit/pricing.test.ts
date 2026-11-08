import { describe, expect, it } from 'vitest'
import { PLAN_TIERS } from '#shared/plans'
import { TIER_PRICES_UZS, getTierPriceTiyin } from '../../server/utils/pricing'

describe('getTierPriceTiyin', () => {
  it('returns the price in tiyin (1 sum = 100 tiyin)', () => {
    expect(getTierPriceTiyin('basic')).toBe(39_000_000)
    expect(getTierPriceTiyin('pro')).toBe(79_000_000)
    expect(getTierPriceTiyin('premium')).toBe(199_000_000)
    expect(getTierPriceTiyin('luxury')).toBe(299_000_000)
  })

  it('prices a missing tier as the column default (basic)', () => {
    expect(getTierPriceTiyin(null)).toBe(getTierPriceTiyin('basic'))
    expect(getTierPriceTiyin(undefined)).toBe(getTierPriceTiyin('basic'))
  })

  it('refuses to guess a price for an unknown tier', () => {
    for (const t of ['', 'Pro', 'gold', 'basic ', 'free']) expect(getTierPriceTiyin(t)).toBeNull()
  })

  it('does not read prices off the object prototype', () => {
    for (const t of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(getTierPriceTiyin(t)).toBeNull()
    }
  })

  it('has a price for every tier and nothing else, rising with the tier', () => {
    expect(Object.keys(TIER_PRICES_UZS).sort()).toEqual([...PLAN_TIERS].sort())
    const prices = PLAN_TIERS.map((t) => getTierPriceTiyin(t)!)
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1]!)
    for (const p of prices) expect(Number.isSafeInteger(p)).toBe(true)
  })
})
