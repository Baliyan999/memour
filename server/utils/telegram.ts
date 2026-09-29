/**
 * Telegram helpers — outbound notifications via the Memour bot.
 *
 * - `sendTelegram(text, chatId?)` — send and report the outcome.
 *   chatId defaults to TELEGRAM_LEAD_CHAT_ID (the founder's chat).
 *   Never throws; notifications can ignore the result, but anything a
 *   user waits for (admin 2FA codes) must check `ok`.
 * - `escapeHtml(s)` — for any user-supplied value in a message.
 * - `notifyEventUpload(eventId)` — debounced "new photo on event X"
 *   alert. We keep a small in-memory map of last-sent timestamps to
 *   coalesce dozens of uploads at the venue into one notification
 *   every few minutes per event.
 * - `adminLink(path)` / `shortId(uuid)` — what a notification may
 *   carry instead of personal data.
 *
 * No personal data goes to Telegram: no names (guests' or the
 * couple's), phones, dates or free text from a form. Telegram keeps
 * messages on servers outside Uzbekistan, so every alert is a neutral
 * ping — a short id and a link into the admin panel, where the details
 * are behind a login.
 *
 * In-memory state is per-process, so when we scale to multiple Nitro
 * instances the debounce won't be perfect — that's OK; worst case is
 * a few extra Telegram messages, not spammy enough to bother.
 */

export interface TelegramResult {
  ok: boolean
  /**
   * The chat can't be reached: wrong chat_id (400 "chat not found") or
   * the person never pressed Start / blocked the bot (403). Retrying
   * won't help until they fix that on their side.
   */
  unreachable?: boolean
}

export async function sendTelegram(text: string, chatId?: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const target = chatId ?? process.env.TELEGRAM_LEAD_CHAT_ID
  if (!token || !target) {
    console.warn('[telegram] not configured (TELEGRAM_BOT_TOKEN / chat id missing)')
    return { ok: false }
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: target, text, parse_mode: 'HTML' }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return { ok: true }
    // Log Telegram's reason, never the text — it may carry a login code.
    const json: any = await res.json().catch(() => ({}))
    const reason = String(json?.description ?? '')
    console.error(`[telegram] send failed: ${res.status} ${reason}`)
    return { ok: false, unreachable: res.status === 403 || /chat not found/i.test(reason) }
  } catch (e: any) {
    console.error('[telegram] send failed:', e?.message ?? e)
    return { ok: false }
  }
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
export async function notifyEventUpload(eventId: string): Promise<boolean> {
  const now = Date.now()
  const entry = debounceMap.get(eventId)
  if (entry && now - entry.lastSentAt < DEBOUNCE_MS) {
    entry.pendingCount += 1
    return false
  }
  const pending = entry ? entry.pendingCount + 1 : 1
  debounceMap.set(eventId, { lastSentAt: now, pendingCount: 0 })

  const text =
    `📸 Новые файлы в событии #${shortId(eventId)}\n` +
    (pending > 1 ? `Загружено: ${pending} с прошлого уведомления\n` : '') +
    adminLink(`/admin/event/${eventId}`)

  await sendTelegram(text)
  return true
}

// Telegram's HTML mode rejects the whole message on a stray < or &
// ("Aziz & Madina"), and unescaped input could smuggle links into the
// chat — so every user-supplied value goes through this.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** First 8 hex digits of a UUID — enough to find the row in the admin. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

/** Absolute link into the (Russian-language) admin panel. */
export function adminLink(path: string): string {
  const site = String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/+$/, '')
  return `${site}/ru${path}`
}
