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

export function getTierPriceTiyin(tier: string): number {
  const uzs = TIER_PRICES_UZS[tier] ?? TIER_PRICES_UZS.basic!
  // Eskiz / Payme / Click expect amounts in tiyin (1 sum = 100 tiyin)
  return uzs * 100
}
