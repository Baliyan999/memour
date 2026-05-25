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
 * Values are intentionally generous for photos (where guests will be
 * trigger-happy) and tight for video / voice (large + harder to
 * moderate).
 */
export const DEVICE_LIMITS = {
  photo: 15,
  video: 3,
  voice: 3,
} as const

export type GuestMediaKind = keyof typeof DEVICE_LIMITS

/** Column name on `guest_devices` that tracks uploads of this kind. */
export function counterColumn(kind: GuestMediaKind): 'photo_count' | 'video_count' | 'voice_count' {
  return kind === 'photo' ? 'photo_count' : kind === 'video' ? 'video_count' : 'voice_count'
}
