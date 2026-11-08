import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serverSupabaseServiceRole } from '#supabase/server'
import * as plans from '#shared/plans'
import {
  DEVICE_LIMITS_BY_TIER,
  GUEST_LIMIT_BY_TIER,
  claimGuestDevice,
  counterColumn,
  deviceLimitsForTier,
  guestLimitForTier,
} from '../../server/utils/guest-quota'

vi.mock('#supabase/server', () => ({ serverSupabaseServiceRole: vi.fn() }))

const rpc = vi.fn()
const event = {} as never
const args = { eventId: 'e-1', deviceId: 'd-1', table: 3, guestName: 'Aziza', tier: 'pro' }

beforeEach(() => {
  rpc.mockReset()
  vi.mocked(serverSupabaseServiceRole).mockReturnValue({ rpc } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('counterColumn', () => {
  it('maps each media kind to its guest_devices counter', () => {
    expect(counterColumn('photo')).toBe('photo_count')
    expect(counterColumn('video')).toBe('video_count')
    expect(counterColumn('voice')).toBe('voice_count')
  })
})

describe('re-exports', () => {
  it('are the shared tier table, not a copy that can drift', () => {
    expect(DEVICE_LIMITS_BY_TIER).toBe(plans.DEVICE_LIMITS_BY_TIER)
    expect(GUEST_LIMIT_BY_TIER).toBe(plans.GUEST_LIMIT_BY_TIER)
    expect(deviceLimitsForTier).toBe(plans.deviceLimitsForTier)
    expect(guestLimitForTier).toBe(plans.guestLimitForTier)
  })
})

describe('claimGuestDevice', () => {
  it('asks the database for a place under the cap of the tier it was given', async () => {
    rpc.mockResolvedValue({ data: 'created', error: null })
    await expect(claimGuestDevice(event, args)).resolves.toBe('created')
    expect(rpc).toHaveBeenCalledWith('claim_guest_device', {
      p_event_id: 'e-1',
      p_device_id: 'd-1',
      p_table_number: 3,
      p_max_devices: 150,
      p_guest_name: 'Aziza',
    })
  })

  it('uses the Basic cap when the tier is unknown', async () => {
    rpc.mockResolvedValue({ data: 'created', error: null })
    await claimGuestDevice(event, { ...args, tier: null })
    expect(rpc.mock.calls[0]![1].p_max_devices).toBe(50)
  })

  it('leaves the stored name alone when the guest gave none', async () => {
    rpc.mockResolvedValue({ data: 'existing', error: null })
    await expect(claimGuestDevice(event, { ...args, guestName: null })).resolves.toBe('existing')
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_guest_name')
  })

  it('turns a full event into 409 guest_limit_reached', async () => {
    rpc.mockResolvedValue({ data: 'limit_reached', error: null })
    await expect(claimGuestDevice(event, args)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'guest_limit_reached' },
    })
  })

  it('reports a database failure as 500 server_error, without its text', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function claim_guest_device' } })
    const err = await claimGuestDevice(event, args).catch((e) => e)
    expect(err).toMatchObject({ statusCode: 500, statusMessage: 'server_error', data: { code: 'server_error' } })
    expect(JSON.stringify(err)).not.toContain('permission denied')
  })
})
