/**
 * Per-device upload quotas for guests at a wedding.
 *
 * Why per-device, not per-event:
 *   We want every guest to be able to send a healthy number of photos
 *   without one person flooding the album with a hundred selfies. The
 *   binding model (see `guest_devices`) ties a browser to a single
 *   table per event, and the counters below are the upper bound on
 *   that single browser's contribution.
 *
 * A guest can hard-reset their browser storage to bypass these — we
 * accept that. The point is to make accidental over-uploading hard,
 * not to defeat a motivated attacker (who could also just use a
 * second phone).
 *
 * The numbers are what the pricing cards promise (i18n pricing.*):
 *   Basic   — "20 фото с каждого"            → 20 photos, no video
 *   Pro     — "30 фото + 5 видео-клипов"      → 30 photos, 5 videos
 *   Premium — "50 фото + 15 видео на гостя"   → 50 photos, 15 videos
 *   Luxury  — "Всё из Premium"                → same as Premium
 * Voice messages ship with Premium and up (the guest UI has always
 * gated them there); the copy doesn't name a number, so they keep
 * the original 3 per device. A 0 means the tier doesn't include
 * that kind of media at all — the upload endpoint rejects it.
 * Change these together with the pricing copy.
 */
export type GuestMediaKind = 'photo' | 'video' | 'voice'
export type DeviceLimits = Record<GuestMediaKind, number>

export const DEVICE_LIMITS_BY_TIER: Record<'basic' | 'pro' | 'premium' | 'luxury', DeviceLimits> = {
  basic: { photo: 20, video: 0, voice: 0 },
  pro: { photo: 30, video: 5, voice: 0 },
  premium: { photo: 50, video: 15, voice: 3 },
  luxury: { photo: 50, video: 15, voice: 3 },
}

/** Limits for an event's plan_tier; unknown / null tiers get Basic. */
export function deviceLimitsForTier(tier: string | null | undefined): DeviceLimits {
  return DEVICE_LIMITS_BY_TIER[(tier ?? 'basic') as keyof typeof DEVICE_LIMITS_BY_TIER]
    ?? DEVICE_LIMITS_BY_TIER.basic
}

/** Column name on `guest_devices` that tracks uploads of this kind. */
export function counterColumn(kind: GuestMediaKind): 'photo_count' | 'video_count' | 'voice_count' {
  return kind === 'photo' ? 'photo_count' : kind === 'video' ? 'video_count' : 'voice_count'
}
