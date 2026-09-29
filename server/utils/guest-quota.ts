/**
 * Guest limits for a wedding: per-device upload quotas and the number
 * of guest devices an event takes. The numbers live in shared/plans.ts
 * (one table for the server and the pages); they are re-exported here
 * for the guest endpoints.
 *
 * Why per-device, not per-event:
 *   We want every guest to be able to send a healthy number of photos
 *   without one person flooding the album with a hundred selfies. The
 *   binding model (see `guest_devices`) ties a browser to a single
 *   table per event, and the per-kind counters are the upper bound on
 *   that single browser's contribution.
 *
 * A guest can hard-reset their browser storage to bypass these — we
 * accept that. The point is to make accidental over-uploading hard,
 * not to defeat a motivated attacker (who could also just use a
 * second phone).
 *
 * The guest cap counts those same devices: a browser that clears its
 * storage comes back as a new guest and takes a new place.
 * claimGuestDevice() takes a place atomically (SQL function
 * public.claim_guest_device), so two new guests arriving at the same
 * instant can't both get the last one.
 */
import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { guestLimitForTier } from '#shared/plans'
import { fail } from './errors'

export {
  DEVICE_LIMITS_BY_TIER,
  GUEST_LIMIT_BY_TIER,
  deviceLimitsForTier,
  guestLimitForTier,
  type DeviceLimits,
  type GuestMediaKind,
} from '#shared/plans'

/** Column name on `guest_devices` that tracks uploads of this kind. */
export function counterColumn(kind: 'photo' | 'video' | 'voice'): 'photo_count' | 'video_count' | 'voice_count' {
  return kind === 'photo' ? 'photo_count' : kind === 'video' ? 'video_count' : 'voice_count'
}

export type ClaimResult = 'existing' | 'created'

/**
 * Bind a device to the event unless the event is full: 'created' (a new
 * row, counters at 0) or 'existing' (it was already in — never refused,
 * whatever the cap). A full event → 409 guest_limit_reached. The cap
 * comes from the tier the caller just read from the event, so an
 * upgrade applies to the very next guest.
 */
export async function claimGuestDevice(
  event: H3Event,
  args: { eventId: string; deviceId: string; table: number; guestName: string | null; tier: string | null },
): Promise<ClaimResult> {
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data, error } = await admin.rpc('claim_guest_device', {
    p_event_id: args.eventId,
    p_device_id: args.deviceId,
    p_table_number: args.table,
    p_max_devices: guestLimitForTier(args.tier),
    ...(args.guestName ? { p_guest_name: args.guestName } : {}),
  })
  if (error) {
    console.error('[guest-quota] claim_guest_device failed', error)
    fail(500, 'server_error')
  }
  if (data === 'limit_reached') fail(409, 'guest_limit_reached')
  return data === 'existing' ? 'existing' : 'created'
}
