import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { userId } from '../../../../../utils/auth'
import { fail } from '../../../../../utils/errors'
import { UUID_RE } from '../../../../../utils/payments'
import { sendTelegram } from '../../../../../utils/telegram'
import { closeLink } from '../../../../../utils/telegram-couple'
import { botText } from '../../../../../utils/telegram-texts'

/**
 * DELETE /api/couple/telegram/links/[eventId]/[linkId] — "Uzish /
 * Отключить": the chat stops getting this event's notifications. The
 * row keeps no chat id, name or username afterwards.
 *
 * The event's owner only; 404 not_found when the link isn't connected
 * (already disconnected, or another event's). The chat is told, in its
 * own language — best effort, the answer doesn't wait for Telegram.
 */
export default defineEventHandler(async (event) => {
  const uid = await userId(event)
  if (!uid) fail(401, 'unauthorized')

  const eventId = getRouterParam(event, 'eventId')
  const linkId = getRouterParam(event, 'linkId')
  if (!eventId || !UUID_RE.test(eventId) || !linkId || !UUID_RE.test(linkId)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: ev, error } = await admin
    .from('events')
    .select('id, owner_id, couple_names')
    .eq('id', eventId!)
    .maybeSingle()
  if (error) fail(500, 'lookup_failed')
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== uid) fail(403, 'forbidden')

  const { data: link, error: linkErr } = await admin
    .from('telegram_chat_links')
    .select('id, chat_id, locale')
    .eq('id', linkId!)
    .eq('event_id', ev!.id)
    .is('unlinked_at', null)
    .maybeSingle()
  if (linkErr) fail(500, 'lookup_failed')
  if (!link) fail(404, 'not_found')

  const closed = await closeLink(admin, link!.id, 'dashboard')
  if (closed === 'failed') fail(500, 'unlink_failed')
  // Disconnected a moment ago from elsewhere (/stop, a second tab).
  if (closed === 'not_open') fail(404, 'not_found')

  if (link!.chat_id != null) {
    const locale = link!.locale === 'ru' ? 'ru' : 'uz'
    void sendTelegram(botText.unlinkedFromDashboard(locale, { names: ev!.couple_names }), link!.chat_id, { noPreview: true })
  }
  return { ok: true }
})
