import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { userId } from '../../../../utils/auth'
import { fail } from '../../../../utils/errors'
import { UUID_RE } from '../../../../utils/payments'
import { coupleBotReady } from '../../../../utils/telegram-couple'

/**
 * GET /api/couple/telegram/links/[eventId] — the chats connected to the
 * event's notifications, newest first: { links: [{ id, first_name,
 * username, linked_at }], ready }. `ready` is false while the server
 * can't run the bot (the dashboard then doesn't offer to connect).
 *
 * The event's owner only. The chat id itself never leaves the server.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const uid = await userId(event)
  if (!uid) fail(401, 'unauthorized')

  const eventId = getRouterParam(event, 'eventId')
  if (!eventId || !UUID_RE.test(eventId)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: ev, error } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', eventId!)
    .maybeSingle()
  if (error) fail(500, 'lookup_failed')
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== uid) fail(403, 'forbidden')

  const { data: links, error: listErr } = await admin
    .from('telegram_chat_links')
    .select('id, first_name, username, linked_at')
    .eq('event_id', ev!.id)
    .is('unlinked_at', null)
    .order('linked_at', { ascending: false })
  if (listErr) fail(500, 'list_failed')

  return { links: links ?? [], ready: coupleBotReady() }
})
