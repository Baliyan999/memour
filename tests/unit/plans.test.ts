import { describe, expect, it } from 'vitest'
import {
  DEVICE_LIMITS_BY_TIER,
  GUEST_LIMIT_BY_TIER,
  GUEST_LIMIT_WARN_AT,
  PLAN_FEATURES,
  PLAN_TIERS,
  deviceLimitsForTier,
  guestLimitForTier,
  planTier,
  tierHas,
  type PlanFeature,
} from '#shared/plans'
import { TIER_PRICES_UZS } from '../../server/utils/pricing'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'

describe('planTier', () => {
  it('keeps every known tier', () => {
    for (const t of PLAN_TIERS) expect(planTier(t)).toBe(t)
  })

  it('treats a missing or unknown tier as basic, never as a paid one', () => {
    for (const t of [null, undefined, '', 'Pro', 'PRO', ' pro', 'gold', 'toString', '__proto__']) {
      expect(planTier(t)).toBe('basic')
    }
  })
})

describe('tierHas', () => {
  const features: PlanFeature[] = ['live_slideshow', 'branding', 'telegram_bot']

  it('gives Basic none of the Pro features', () => {
    for (const f of features) expect(tierHas('basic', f)).toBe(false)
  })

  it('gives every feature from Pro up', () => {
    for (const t of ['pro', 'premium', 'luxury'] as const) {
      for (const f of features) expect(tierHas(t, f)).toBe(true)
    }
  })

  it('denies features to an unknown or missing tier', () => {
    for (const f of features) {
      expect(tierHas(null, f)).toBe(false)
      expect(tierHas('enterprise', f)).toBe(false)
    }
  })

  it('never takes a feature away on an upgrade', () => {
    for (let i = 1; i < PLAN_TIERS.length; i++) {
      const lower = PLAN_FEATURES[PLAN_TIERS[i - 1]!]
      const higher = PLAN_FEATURES[PLAN_TIERS[i]!]
      for (const f of lower) expect(higher).toContain(f)
    }
  })
})

describe('per-device quotas', () => {
  it('match the tier table', () => {
    expect(deviceLimitsForTier('basic')).toEqual({ photo: 20, video: 0, voice: 0 })
    expect(deviceLimitsForTier('pro')).toEqual({ photo: 30, video: 5, voice: 0 })
    expect(deviceLimitsForTier('premium')).toEqual({ photo: 50, video: 15, voice: 3 })
    expect(deviceLimitsForTier('luxury')).toEqual(deviceLimitsForTier('premium'))
  })

  it('fall back to Basic for an unknown tier (no video, no voice)', () => {
    expect(deviceLimitsForTier('platinum')).toEqual(DEVICE_LIMITS_BY_TIER.basic)
    expect(deviceLimitsForTier(undefined)).toEqual(DEVICE_LIMITS_BY_TIER.basic)
  })

  it('never shrink on an upgrade', () => {
    for (let i = 1; i < PLAN_TIERS.length; i++) {
      const lower = DEVICE_LIMITS_BY_TIER[PLAN_TIERS[i - 1]!]
      const higher = DEVICE_LIMITS_BY_TIER[PLAN_TIERS[i]!]
      for (const kind of ['photo', 'video', 'voice'] as const) {
        expect(higher[kind]).toBeGreaterThanOrEqual(lower[kind])
      }
    }
  })
})

describe('guest caps', () => {
  it('are 50 / 150 / 300 / 500', () => {
    expect(PLAN_TIERS.map(guestLimitForTier)).toEqual([50, 150, 300, 500])
  })

  it('fall back to the Basic cap for an unknown tier', () => {
    expect(guestLimitForTier(null)).toBe(GUEST_LIMIT_BY_TIER.basic)
    expect(guestLimitForTier('vip')).toBe(50)
  })

  it('warn before the cap, not at it', () => {
    expect(GUEST_LIMIT_WARN_AT).toBeGreaterThan(0)
    expect(GUEST_LIMIT_WARN_AT).toBeLessThan(1)
  })
})

/**
 * CLAUDE.md rule 1: the pricing cards promise exactly what the server
 * enforces. Each card's price, guest cap and media quota is read back
 * from i18n and compared with shared/plans.ts and server/utils/pricing.ts.
 */
describe('pricing copy matches the tier table', () => {
  type Card = Record<string, string>
  const cards = (locale: typeof ru | typeof uz, tier: string): Card =>
    (locale.pricing as unknown as Record<string, Card>)[tier]!
  const featureLines = (card: Card) =>
    Object.entries(card).filter(([k]) => /^f\d+$/.test(k)).map(([, v]) => v)
  // \s, not a space: the copy keeps numbers and words together with U+00A0.
  const locales = [
    { name: 'ru', messages: ru, guests: /^До\s(\d+)\sгостей$/, quota: /^(\d+)\sфото(?:\s\+\s(\d+)\sвидео)?/ },
    { name: 'uz', messages: uz, guests: /^(\d+)\smehmongacha$/, quota: /(\d+)\ssurat(?:\s\+\s(\d+)\svideo)?/ },
  ]

  for (const { name, messages, guests, quota } of locales) {
    for (const tier of PLAN_TIERS) {
      it(`${name} ${tier}: price, guest cap and quotas`, () => {
        const card = cards(messages, tier)
        expect(card.price!.replace(/\D/g, '')).toBe(String(TIER_PRICES_UZS[tier]))

        const lines = featureLines(card)
        const cap = lines.map((l) => guests.exec(l)).find(Boolean)
        expect(cap, `no guest cap line on the ${tier} card`).toBeTruthy()
        expect(Number(cap![1])).toBe(GUEST_LIMIT_BY_TIER[tier])

        const q = lines.map((l) => quota.exec(l)).find(Boolean)
        if (tier === 'luxury') {
          // "Всё из Premium": no quota line of its own.
          expect(q).toBeFalsy()
          expect(DEVICE_LIMITS_BY_TIER.luxury).toEqual(DEVICE_LIMITS_BY_TIER.premium)
        } else {
          expect(q, `no quota line on the ${tier} card`).toBeTruthy()
          expect(Number(q![1])).toBe(DEVICE_LIMITS_BY_TIER[tier].photo)
          expect(Number(q![2] ?? 0)).toBe(DEVICE_LIMITS_BY_TIER[tier].video)
        }
      })
    }
  }
})
