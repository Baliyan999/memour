/**
 * Telegram helpers — outbound notifications via the Memour bot.
 *
 * - `sendTelegram(text, chatId?)` — fire-and-forget send. chatId
 *   defaults to TELEGRAM_LEAD_CHAT_ID (the founder's chat).
 * - `notifyEventUpload(eventId, eventName)` — debounced "new photo
 *   on event X" alert. We keep a small in-memory map of last-sent
 *   timestamps to coalesce dozens of uploads at the venue into one
 *   notification every few minutes per event.
 *
 * In-memory state is per-process, so when we scale to multiple Nitro
 * instances the debounce won't be perfect — that's OK; worst case is
 * a few extra Telegram messages, not spammy enough to bother.
 */

export async function sendTelegram(text: string, chatId?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const target = chatId ?? process.env.TELEGRAM_LEAD_CHAT_ID
  if (!token || !target)
    return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML' }),
  }).catch(e => console.error('[telegram] send failed', e))
}

interface DebounceEntry {
  lastSentAt: number
  pendingCount: number
}
const debounceMap = new Map<string, DebounceEntry>()
const DEBOUNCE_MS = 5 * 60 * 1000 // one alert per event per 5 minutes

/**
 * Notify about a new photo upload — debounced per event.
 * Returns true if a Telegram message was sent.
 */
export async function notifyEventUpload(
  eventId: string,
  eventName: string,
): Promise<boolean> {
  const now = Date.now()
  const entry = debounceMap.get(eventId)
  if (entry && now - entry.lastSentAt < DEBOUNCE_MS) {
    entry.pendingCount += 1
    return false
  }
  const pending = entry ? entry.pendingCount + 1 : 1
  debounceMap.set(eventId, { lastSentAt: now, pendingCount: 0 })

  const text
    = `📸 Новые фото на свадьбе\n`
      + `<b>${escapeHtml(eventName)}</b>\n${
        pending > 1 ? `Загружено: ${pending} с прошлого уведомления` : ''}`

  await sendTelegram(text)
  return true
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
