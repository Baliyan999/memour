/**
 * What each tier includes — one source of truth for the server, which
 * enforces it, and the pages that explain it (dashboard, admin). The
 * pricing cards (i18n pricing.*) promise exactly this; change the two
 * together.
 *
 * Per-device quotas (server/utils/guest-quota.ts has the why):
 *   Basic   — "20 фото с каждого"            → 20 photos, no video
 *   Pro     — "30 фото + 5 видео-клипов"      → 30 photos, 5 videos
 *   Premium — "50 фото + 15 видео на гостя"   → 50 photos, 15 videos
 *   Luxury  — "Всё из Premium"                → same as Premium
 * Voice messages ship with Premium and up, 3 per device. A 0 means the
 * tier doesn't include that kind of media at all — the upload endpoint
 * rejects it.
 *
 * Guests per event ("До 50 / 150 / 300 / 500 гостей"): a guest is one
 * browser bound to the event (a `guest_devices` row). The server lets
 * a new one in only while the event has fewer than this many; devices
 * already in are never turned away, and an upgrade raises the cap at
 * once (it is read from the event's tier on every claim).
 *
 * Features: the live slideshow and the couple's design of the guest
 * page (cover, colour, greeting) start at Pro.
 */
export const PLAN_TIERS = ['basic', 'pro', 'premium', 'luxury'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export type GuestMediaKind = 'photo' | 'video' | 'voice'
export type DeviceLimits = Record<GuestMediaKind, number>

export const DEVICE_LIMITS_BY_TIER: Record<PlanTier, DeviceLimits> = {
  basic: { photo: 20, video: 0, voice: 0 },
  pro: { photo: 30, video: 5, voice: 0 },
  premium: { photo: 50, video: 15, voice: 3 },
  luxury: { photo: 50, video: 15, voice: 3 },
}

/** Distinct guest devices an event takes, by tier. */
export const GUEST_LIMIT_BY_TIER: Record<PlanTier, number> = {
  basic: 50,
  pro: 150,
  premium: 300,
  luxury: 500,
}

export type PlanFeature = 'live_slideshow' | 'branding'

export const PLAN_FEATURES: Record<PlanTier, readonly PlanFeature[]> = {
  basic: [],
  pro: ['live_slideshow', 'branding'],
  premium: ['live_slideshow', 'branding'],
  luxury: ['live_slideshow', 'branding'],
}

/** The event's tier; a missing or unknown one is Basic. */
export function planTier(tier: string | null | undefined): PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(tier ?? '') ? (tier as PlanTier) : 'basic'
}

/** Per-device limits for an event's plan_tier. */
export function deviceLimitsForTier(tier: string | null | undefined): DeviceLimits {
  return DEVICE_LIMITS_BY_TIER[planTier(tier)]
}

/** How many guest devices an event of this tier takes. */
export function guestLimitForTier(tier: string | null | undefined): number {
  return GUEST_LIMIT_BY_TIER[planTier(tier)]
}

/** Whether the tier includes the feature. */
export function tierHas(tier: string | null | undefined, feature: PlanFeature): boolean {
  return PLAN_FEATURES[planTier(tier)].includes(feature)
}

/** From this share of the guest limit on, the pages warn that it is close. */
export const GUEST_LIMIT_WARN_AT = 0.9
