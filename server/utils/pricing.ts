/**
 * Tier → price (in UZS, minor units / tiyin). The four tiers mirror
 * the landing page Pricing section. Prices are intentionally hardcoded
 * here rather than in the DB so they're version-controlled.
 *
 * Source of truth — landing Pricing.vue. Keep in sync.
 */
export const TIER_PRICES_UZS: Record<string, number> = {
  basic: 390_000,
  pro: 790_000,
  premium: 1_990_000,
  luxury: 2_990_000,
}

/**
 * Price of a tier in tiyin (1 sum = 100 tiyin) — the unit Payme and our
 * `payments.amount` use. A missing tier is the column default (basic);
 * an unknown one returns null so nothing is ever sold at a guessed price.
 */
export function getTierPriceTiyin(tier: string | null | undefined): number | null {
  const key = tier ?? 'basic'
  if (!Object.hasOwn(TIER_PRICES_UZS, key)) return null
  return TIER_PRICES_UZS[key]! * 100
}
