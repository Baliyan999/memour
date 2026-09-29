import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../../utils/errors'

/**
 * DELETE /api/admin/events/[id]/idle-guests — give back the guest
 * places held by phones that never sent anything.
 *
 * Every phone that joins an event takes one of its tier's guest places
 * (shared/plans.ts), and the event id is printed on each table card. If
 * places were used up by phones that didn't send a single file — a
 * script, or guests who only typed their name — real guests are turned
 * away with "all places are taken". This deletes exactly those
 * guest_devices rows (all three counters at 0) and nothing else:
 * phones that sent something keep their place, their counters and
 * their table. Their consent records stay (consent_events is
 * append-only evidence).
 *
 * A phone freed this way that comes back simply joins again (welcome
 * screen or its next upload) while there is room. An upload in flight
 * has already raised its counter before storing, so it is never freed
 * mid-way.
 *
 * Returns how many places were freed and the guests left.
 */
export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const adminId: string = (user as any).id ?? (user as any).sub
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', adminId)
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const { data: ev } = await admin.from('events').select('id').eq('id', id!).maybeSingle()
  if (!ev) fail(404, 'event_not_found')

  const { data: freed, error } = await admin
    .from('guest_devices')
    .delete()
    .eq('event_id', id!)
    .eq('photo_count', 0)
    .eq('video_count', 0)
    .eq('voice_count', 0)
    .select('device_id')
  if (error) {
    console.error('[admin/events] free idle guests', error)
    fail(500, 'update_failed')
  }

  const { count, error: countErr } = await admin
    .from('guest_devices')
    .select('device_id', { count: 'exact', head: true })
    .eq('event_id', id!)
  if (countErr) {
    console.error('[admin/events] guest count', countErr)
    fail(500, 'list_failed')
  }

  console.info(`[admin/events] admin ${adminId} freed ${freed?.length ?? 0} idle guest places on event ${id}`)
  return { ok: true, freed: freed?.length ?? 0, guests: count ?? 0 }
})
