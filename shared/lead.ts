/**
 * Lead form limits — one source of truth for the landing form and
 * /api/lead, so the form can tell people exactly what the server will
 * accept instead of discovering it from a rejected request.
 *
 * Guests: big Uzbek weddings routinely pass 1000, so the ceiling only
 * exists to catch typos (the stepper takes up to 4 digits).
 */
export const LEAD_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  guestsMin: 10,
  guestsMax: 5000,
} as const

/** Tiers a Pricing CTA can pre-select for the lead form. */
export const LEAD_TIERS = ['basic', 'pro', 'premium', 'luxury'] as const
export type LeadTier = (typeof LEAD_TIERS)[number]

/** Referral codes as the admin can create them (admin/referrals.post). */
export const REFERRAL_CODE_RE = /^[a-z0-9-]{1,40}$/
