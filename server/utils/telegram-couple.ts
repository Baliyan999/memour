import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { formatDate } from '~/utils/format'
import { PLAN_TIERS, tierHas, type GuestMediaKind } from '#shared/plans'
import { sendTelegram } from './telegram'
import { hitRateLimit } from './rate-limit'
import { botLocaleOf, botText, type BotLocale, type MediaCounts } from './telegram-texts'

/**
 * The couple's side of the Memour bot (Pro and up — shared/plans.ts).
 * One bot for everyone: the same TELEGRAM_BOT_TOKEN that sends the
 * team's alerts and admin codes. Couples connect their own chats.
 *
 * Connecting: the dashboard asks POST /api/couple/telegram/link/[id]
 * for a one-time token (32 random bytes, only its sha256 is stored,
 * 15 minutes) and opens t.me/<bot>?start=<token>. Telegram delivers
 * "/start <token>" to POST /api/telegram/webhook, which lands in
 * handleTelegramUpdate() below: the token is consumed in one UPDATE
 * (so it works once), the chat is linked to the event, and the bot
 * confirms in the language the couple used on the site.
 *
 * What the couple gets (only chats still connected, only while the
 * tier includes the bot, each chat in its own language):
 *   - a digest of guest uploads: the first upload opens a window
 *     (TELEGRAM_DIGEST_WINDOW_SECONDS, default 600), everything that
 *     arrives in it goes out as one message when it closes — at most
 *     one message per event per window, counts only, never a guest's
 *     name. In-memory: one Node process; pending digests are sent on
 *     shutdown (server/plugins/telegram-digest.ts);
 *   - "payment received" when the event goes draft → active
 *     (notifyEventActivated, once per event);
 *   - the reminders to download the archive 30 and 7 days before
 *     archive_expires_at (server/tasks/telegram-reminders.ts, daily).
 *     telegram_notifications makes each of these one-off messages go
 *     out once (a reminder once per expiry date: the table forgets it
 *     when the date moves).
 *
 * A chat Telegram says is gone (403: bot blocked, 400: chat not found)
 * is disconnected on the spot; /stop, blocking the bot and "Uzish" in
 * the dashboard do the same. A disconnected row keeps no chat id, name
 * or username (the privacy page promises that).
 */

type Admin = ReturnType<typeof serverSupabaseServiceRole<Database>>
type UnlinkReason = 'stop' | 'blocked' | 'dashboard' | 'unreachable' | 'expired'

export const LINK_TOKEN_TTL_MS = 15 * 60_000
const DAY_MS = 86_400_000
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

let bareClient: Admin | null = null
/**
 * Service-role client for work that outlives any request (digest
 * timers, the daily task, shutdown). serverSupabaseServiceRole() only
 * needs an event for its client cache, so it gets a bare one — the
 * cleanup-archives task does the same.
 */
export function serviceClient(): Admin {
  bareClient ??= serverSupabaseServiceRole<Database>({ context: { nitro: {} } } as unknown as H3Event)
  return bareClient
}

// ─── Configuration ────────────────────────────────────────────────────

/** The bot's @username without the "@", or null. */
export function botUsername(): string | null {
  const u = String(process.env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '')
  return /^[A-Za-z0-9_]{5,32}$/.test(u) ? u : null
}

/**
 * Couples can connect only when the bot can both send (token), be
 * linked to (username) and hear the "/start" (webhook secret).
 */
export function coupleBotReady(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!botUsername() && !!process.env.TELEGRAM_WEBHOOK_SECRET
}

/**
 * Constant-time check of the webhook's X-Telegram-Bot-Api-Secret-Token.
 * Both sides are hashed first, so neither the length nor the content
 * leaks through timing. No secret configured → nothing matches.
 */
export function webhookSecretMatches(got: string | undefined | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !got) return false
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(secret).digest()
  return timingSafeEqual(a, b)
}

function siteUrl(): string {
  return String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/+$/, '')
}

/** The couple's dashboard (or one event in it), in their language. */
export function dashboardHref(locale: BotLocale, eventId?: string): string {
  return `${siteUrl()}/${locale}/dashboard${eventId ? `/event/${eventId}` : ''}`
}

// ─── Link tokens ──────────────────────────────────────────────────────

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** A fresh deep-link token: 32 random bytes, base64url (43 chars — fits Telegram's 64-char start parameter). */
export function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashLinkToken(token) }
}

// ─── Links ────────────────────────────────────────────────────────────

const CLOSED = (reason: UnlinkReason) => ({
  unlinked_at: new Date().toISOString(),
  unlink_reason: reason,
  chat_id: null,
  first_name: null,
  username: null,
})

/**
 * Disconnect one link. 'closed' — it was open and now isn't;
 * 'not_open' — already disconnected (no-op); 'failed' — the database
 * refused, the link may still be open.
 */
export async function closeLink(
  admin: Admin,
  linkId: string,
  reason: UnlinkReason,
): Promise<'closed' | 'not_open' | 'failed'> {
  const { data, error } = await admin
    .from('telegram_chat_links')
    .update(CLOSED(reason))
    .eq('id', linkId)
    .is('unlinked_at', null)
    .select('id')
  if (error) {
    console.error('[telegram-bot] unlink failed', error.code)
    return 'failed'
  }
  return (data ?? []).length > 0 ? 'closed' : 'not_open'
}

/** Disconnect every event a chat follows. Returns how many links were open. */
async function closeChat(admin: Admin, chatId: number, reason: UnlinkReason): Promise<number> {
  const { data, error } = await admin
    .from('telegram_chat_links')
    .update(CLOSED(reason))
    .eq('chat_id', chatId)
    .is('unlinked_at', null)
    .select('id')
  if (error) {
    console.error('[telegram-bot] unlink chat failed', error.code)
    return 0
  }
  return (data ?? []).length
}

/**
 * Send one message per connected chat of the event, one after another
 * (a handful of chats per wedding — far below Telegram's limits).
 * Unreachable chats are disconnected. Links are read in pages by id
 * (PostgREST caps a read at 1000 rows); closing one on the way doesn't
 * shift the next page, which starts after the last id seen.
 */
export async function sendToEventChats(
  admin: Admin,
  eventId: string,
  build: (locale: BotLocale) => string,
): Promise<{ sent: number; failed: number; chats: number }> {
  let sent = 0
  let failed = 0
  let chats = 0
  let after: string | null = null
  for (;;) {
    let q = admin
      .from('telegram_chat_links')
      .select('id, chat_id, locale')
      .eq('event_id', eventId)
      .is('unlinked_at', null)
      .order('id')
      .limit(PAGE)
    if (after) q = q.gt('id', after)
    const { data: links, error } = await q
    if (error) {
      console.error('[telegram-bot] links lookup failed', error.code)
      break
    }
    if (!links?.length) break
    after = links.at(-1)!.id
    chats += links.length
    for (const l of links) {
      if (l.chat_id == null) continue
      const res = await sendTelegram(build(l.locale === 'ru' ? 'ru' : 'uz'), l.chat_id, { noPreview: true })
      if (res.ok) sent++
      else {
        failed++
        if (res.unreachable) await closeLink(admin, l.id, 'unreachable')
      }
    }
    if (links.length < PAGE) break
  }
  return { sent, failed, chats }
}

// ─── One-off messages ─────────────────────────────────────────────────

type OneOff = 'archive_30d' | 'archive_7d' | 'activated'

/** Take the right to send `kind` for the event. False = already sent (or the DB failed). */
async function claimOneOff(admin: Admin, eventId: string, kind: OneOff): Promise<boolean> {
  const { error } = await admin.from('telegram_notifications').insert({ event_id: eventId, kind })
  if (!error) return true
  if (error.code !== '23505') console.error(`[telegram-bot] ${kind} claim failed`, error.code)
  return false
}

async function releaseOneOff(admin: Admin, eventId: string, kind: OneOff) {
  await admin.from('telegram_notifications').delete().eq('event_id', eventId).eq('kind', kind)
}

async function hasOpenLinks(admin: Admin, eventId: string): Promise<boolean> {
  const { count } = await admin
    .from('telegram_chat_links')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .is('unlinked_at', null)
  return (count ?? 0) > 0
}

/**
 * "Payment received, everything is ready" — once per event, to the
 * chats connected before payment. Never throws; callers don't await it.
 */
export async function notifyEventActivated(admin: Admin, eventId: string): Promise<void> {
  try {
    const { data: ev } = await admin
      .from('events')
      .select('id, couple_names, plan_tier, status')
      .eq('id', eventId)
      .maybeSingle()
    if (!ev || ev.status !== 'active' || !tierHas(ev.plan_tier, 'telegram_bot')) return
    if (!(await hasOpenLinks(admin, eventId))) return
    if (!(await claimOneOff(admin, eventId, 'activated'))) return
    await sendToEventChats(admin, eventId, (locale) =>
      botText.activated(locale, { names: ev.couple_names, href: dashboardHref(locale, eventId) }))
  } catch (e: any) {
    console.error('[telegram-bot] activation notice failed', e?.message ?? e)
  }
}

/** Tiers that include the bot, for filtering in the database. */
const BOT_TIERS = PLAN_TIERS.filter((t) => tierHas(t, 'telegram_bot'))

/**
 * Rows per request. PostgREST returns at most max_rows (1000) rows per
 * request, so every list here is read in pages; 100 ids also keep the
 * `in (…)` filters well inside a URL.
 */
const PAGE = 100

/**
 * The daily reminder run: Pro+ events whose archive expires within 30
 * days (7 days → the last reminder), not purged, not a draft, with
 * something to download and a chat connected. Each (event, kind) goes
 * out once per expiry date (the migration's trigger forgets the sent
 * reminders when archive_expires_at moves); a run that reached nobody
 * gives the claim back so tomorrow retries.
 *
 * It walks the candidate events (a month of weddings), not the open
 * links, which pile up for every connected wedding for up to a year.
 * Both are read in pages anyway.
 */
export async function sendArchiveReminders(admin: Admin, now = Date.now()) {
  const summary = { events: 0, sent: 0, skipped: 0, failed: 0, closed: 0 }
  const nowIso = new Date(now).toISOString()
  const horizonIso = new Date(now + 30 * DAY_MS).toISOString()

  let after: string | null = null
  for (;;) {
    let q = admin
      .from('events')
      .select('id, couple_names, archive_expires_at')
      .is('purged_at', null)
      .neq('status', 'draft')
      .in('plan_tier', BOT_TIERS)
      .gt('archive_expires_at', nowIso)
      .lte('archive_expires_at', horizonIso)
      .order('id')
      .limit(PAGE)
    if (after) q = q.gt('id', after)
    const { data: events, error } = await q
    if (error) {
      console.error('[telegram-bot] reminders: events lookup failed', error.code)
      summary.failed++
      break
    }
    if (!events?.length) break
    after = events.at(-1)!.id

    // What already went out for this page (≤ 2 rows per event).
    const { data: sentRows, error: sentErr } = await admin
      .from('telegram_notifications')
      .select('event_id, kind')
      .in('event_id', events.map((e) => e.id))
      .in('kind', ['archive_30d', 'archive_7d'])
    if (sentErr) {
      console.error('[telegram-bot] reminders: log lookup failed', sentErr.code)
      summary.failed++
      break
    }
    const sent = new Set((sentRows ?? []).map((r) => `${r.event_id}:${r.kind}`))

    for (const ev of events) {
      const left = Date.parse(ev.archive_expires_at!) - now
      const kind: OneOff = left <= 7 * DAY_MS ? 'archive_7d' : 'archive_30d'
      if (sent.has(`${ev.id}:${kind}`)) {
        summary.skipped++
        continue
      }
      if (!(await hasOpenLinks(admin, ev.id))) continue
      const { count } = await admin
        .from('photos')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', ev.id)
        .eq('is_hidden', false)
      if (!count) continue
      if (!(await claimOneOff(admin, ev.id, kind))) {
        summary.skipped++
        continue
      }
      summary.events++
      // The day it is deleted, in Tashkent.
      const day = new Date(Date.parse(ev.archive_expires_at!) + 5 * 3600_000).toISOString().slice(0, 10)
      const days = Math.max(1, Math.ceil(left / DAY_MS))
      const res = await sendToEventChats(admin, ev.id, (locale) => botText.archiveReminder(locale, {
        names: ev.couple_names,
        href: dashboardHref(locale, ev.id),
        days,
        date: formatDate(day, locale),
        last: kind === 'archive_7d',
      }))
      summary.sent += res.sent
      if (res.sent === 0) {
        summary.failed++
        await releaseOneOff(admin, ev.id, kind)
      }
    }
    if (events.length < PAGE) break
  }

  const closed = await closePurgedEventLinks(admin)
  summary.closed = closed.closed
  if (!closed.ok) summary.failed++
  return summary
}

/**
 * The album is gone: nothing more to say, and the chat ids needn't stay.
 * Closes the open links of purged events, a page at a time — each round
 * closes what it read, so the next read starts on what is left.
 */
async function closePurgedEventLinks(admin: Admin): Promise<{ closed: number; ok: boolean }> {
  let closed = 0
  for (let round = 0; round < 100; round++) {
    const { data: rows, error } = await admin
      .from('telegram_chat_links')
      .select('event_id, events!inner(purged_at)')
      .is('unlinked_at', null)
      .not('events.purged_at', 'is', null)
      .order('event_id')
      .limit(1000)
    if (error) {
      console.error('[telegram-bot] reminders: purged links lookup failed', error.code)
      return { closed, ok: false }
    }
    const ids = [...new Set((rows ?? []).map((r) => r.event_id))]
    if (!ids.length) return { closed, ok: true }
    let closedNow = 0
    for (let i = 0; i < ids.length; i += PAGE) {
      const { data, error: upErr } = await admin
        .from('telegram_chat_links')
        .update(CLOSED('expired'))
        .in('event_id', ids.slice(i, i + PAGE))
        .is('unlinked_at', null)
        .select('id')
      if (upErr) {
        console.error('[telegram-bot] reminders: closing purged links failed', upErr.code)
        return { closed, ok: false }
      }
      closedNow += (data ?? []).length
    }
    closed += closedNow
    if (rows!.length < 1000) return { closed, ok: true }
    // A full page read but nothing closed: stop rather than spin.
    if (!closedNow) return { closed, ok: false }
  }
  return { closed, ok: true }
}

/** Link tokens are useless a day after they expire. */
export async function deleteStaleLinkTokens(admin: Admin, now = Date.now()) {
  const { error } = await admin
    .from('telegram_link_tokens')
    .delete()
    .lt('expires_at', new Date(now - DAY_MS).toISOString())
  if (error) console.error('[telegram-bot] token cleanup failed', error.code)
}

// ─── Upload digest ────────────────────────────────────────────────────

interface PendingDigest {
  counts: MediaCounts
  timer: ReturnType<typeof setTimeout>
}
const pendingDigests = new Map<string, PendingDigest>()

/** Digest window: TELEGRAM_DIGEST_WINDOW_SECONDS (tests), default 10 minutes. */
export function digestWindowMs(): number {
  const sec = Number(process.env.TELEGRAM_DIGEST_WINDOW_SECONDS)
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 10 * 60_000
}

/**
 * Count one stored guest upload. The first one opens the event's window;
 * the digest goes out when it closes. Events whose tier has no bot are
 * never queued.
 */
export function queueUploadDigest(eventId: string, tier: string | null, kind: GuestMediaKind): void {
  if (!tierHas(tier, 'telegram_bot')) return
  let p = pendingDigests.get(eventId)
  if (!p) {
    const timer = setTimeout(() => void flushDigest(eventId), digestWindowMs())
    timer.unref?.()
    p = { counts: { photo: 0, video: 0, voice: 0 }, timer }
    pendingDigests.set(eventId, p)
  }
  p.counts[kind]++
}

async function flushDigest(eventId: string): Promise<void> {
  const p = pendingDigests.get(eventId)
  if (!p) return
  pendingDigests.delete(eventId)
  clearTimeout(p.timer)
  try {
    const admin = serviceClient()
    const { data: ev } = await admin
      .from('events')
      .select('id, couple_names, plan_tier, purged_at')
      .eq('id', eventId)
      .maybeSingle()
    if (!ev || ev.purged_at || !tierHas(ev.plan_tier, 'telegram_bot')) return
    await sendToEventChats(admin, eventId, (locale) =>
      botText.digest(locale, { names: ev.couple_names, href: dashboardHref(locale, eventId), counts: p.counts }))
  } catch (e: any) {
    console.error('[telegram-bot] digest failed', e?.message ?? e)
  }
}

/** Send every pending digest now (server shutdown). */
export async function flushAllDigests(): Promise<number> {
  const ids = [...pendingDigests.keys()]
  await Promise.all(ids.map(flushDigest))
  return ids.length
}

// ─── Webhook updates ──────────────────────────────────────────────────

interface TgUser { id?: number; first_name?: string; username?: string; language_code?: string }
interface TgChat { id?: number; type?: string; first_name?: string; username?: string }

const clip = (s: unknown, n: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : null)

/** Both languages, Uzbek first — for someone we know nothing about yet. */
const both = (make: (l: BotLocale) => string) => `${make('uz')}\n\n${make('ru')}`

/**
 * Anyone on Telegram can write to the bot, and its sendMessage budget
 * (~30 a second) is the one admin 2FA codes and the team's alerts use.
 * So the bot answers a chat only so often, and answers to chatter
 * (greeting, help, any text) are also capped for the whole bot. Over
 * a cap it stays silent and does nothing. The commands a couple sends
 * on purpose (/start <token>, /stop) get looser caps of their own —
 * per chat and, so that many accounts sending junk tokens can't eat
 * the budget either, for the whole bot.
 */
function mayAnswer(chatId: number, kind: 'command' | 'chatter'): boolean {
  if (kind === 'command') {
    return hitRateLimit('tg-bot-command', String(chatId), 10, 60_000).ok
      && hitRateLimit('tg-bot-command', '*', 120, 60_000).ok
  }
  return hitRateLimit('tg-bot-chatter', String(chatId), 5, 60_000).ok
    && hitRateLimit('tg-bot-chatter', '*', 60, 60_000).ok
}

/**
 * One update from Telegram (the webhook has checked the secret). Only
 * private chats: "/start <token>", "/start", "/stop", "/help", other
 * text, and my_chat_member (the person blocked the bot). Never throws.
 * Tokens are never logged.
 */
export async function handleTelegramUpdate(update: any): Promise<void> {
  try {
    const admin = serviceClient()

    const member = update?.my_chat_member
    if (member) {
      const chat: TgChat = member.chat ?? {}
      if (chat.type !== 'private' || typeof chat.id !== 'number') return
      if (member.new_chat_member?.status === 'kicked') await closeChat(admin, chat.id, 'blocked')
      return
    }

    const msg = update?.message
    if (!msg) return
    const chat: TgChat = msg.chat ?? {}
    if (chat.type !== 'private' || typeof chat.id !== 'number') return
    const from: TgUser = msg.from ?? {}
    const lang = botLocaleOf(from.language_code)
    const text = typeof msg.text === 'string' ? msg.text.trim() : ''
    const cmd = /^\/([a-z]+)(?:@\w+)?(?:\s+(\S+))?/i.exec(text)
    const command = cmd?.[1]?.toLowerCase()
    const reply = (t: string) => sendTelegram(t, chat.id!, { noPreview: true })

    if (command === 'start' && cmd?.[2]) {
      if (!mayAnswer(chat.id, 'command')) return
      await linkChat(admin, chat.id, from, cmd[2], lang, reply)
      return
    }
    if (!mayAnswer(chat.id, command === 'stop' ? 'command' : 'chatter')) return

    // Where this chat stands: the weddings it follows, and its language.
    const { data: links } = await admin
      .from('telegram_chat_links')
      .select('event_id, locale, linked_at, events(couple_names)')
      .eq('chat_id', chat.id)
      .is('unlinked_at', null)
      .order('linked_at', { ascending: false })
    const open = links ?? []
    const locale: BotLocale | null = (open[0]?.locale as BotLocale | undefined) ?? lang

    if (command === 'stop') {
      const n = await closeChat(admin, chat.id, 'stop')
      await reply(locale ? botText.stopped(locale, n) : both((l) => botText.stopped(l, n)))
      return
    }

    if (command === 'start' && !open.length) {
      await reply(botText.greeting({ uzHref: dashboardHref('uz'), ruHref: dashboardHref('ru') }))
      return
    }

    // /help, /start of a chat that is already connected, anything else.
    if (!locale) {
      await reply(botText.greeting({ uzHref: dashboardHref('uz'), ruHref: dashboardHref('ru') }))
      return
    }
    const names = open.map((l: any) => String(l.events?.couple_names ?? '')).filter(Boolean)
    await reply(botText.help(locale, { names, href: dashboardHref(locale, open.length === 1 ? open[0]!.event_id : undefined) }))
  } catch (e: any) {
    console.error('[telegram-bot] update failed', e?.message ?? e)
  }
}

async function linkChat(
  admin: Admin,
  chatId: number,
  from: TgUser,
  token: string,
  lang: BotLocale | null,
  reply: (t: string) => Promise<unknown>,
) {
  const expired = () => reply(lang
    ? botText.linkExpired(lang, { href: dashboardHref(lang) })
    : both((l) => botText.linkExpired(l, { href: dashboardHref(l) })))
  if (!TOKEN_RE.test(token)) return expired()

  // Consume: one UPDATE, so a token works exactly once even if the
  // same link is opened twice at the same moment.
  const nowIso = new Date().toISOString()
  const { data: claimed, error } = await admin
    .from('telegram_link_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', hashLinkToken(token))
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('event_id, user_id, locale')
  if (error) {
    console.error('[telegram-bot] token claim failed', error.code)
    return reply(botText.linkFailed(lang ?? 'uz'))
  }
  const t = claimed?.[0]
  if (!t) return expired()
  const locale: BotLocale = t.locale === 'ru' ? 'ru' : 'uz'

  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, plan_tier, status, owner_id, purged_at')
    .eq('id', t.event_id)
    .maybeSingle()
  // Gone, handed to another account or already purged since the token was made.
  if (!ev || ev.owner_id !== t.user_id || ev.purged_at) {
    return reply(botText.linkExpired(locale, { href: dashboardHref(locale) }))
  }
  if (!tierHas(ev.plan_tier, 'telegram_bot')) return reply(botText.notInPlan(locale))

  const { error: linkErr } = await admin
    .from('telegram_chat_links')
    .upsert({
      event_id: ev.id,
      user_id: t.user_id,
      chat_id: chatId,
      first_name: clip(from.first_name, 128),
      username: clip(from.username, 64),
      locale,
      linked_at: nowIso,
      unlinked_at: null,
      unlink_reason: null,
    }, { onConflict: 'event_id,chat_id' })
  if (linkErr) {
    console.error('[telegram-bot] link failed', linkErr.code)
    return reply(botText.linkFailed(locale))
  }
  return reply(botText.linked(locale, {
    names: ev.couple_names,
    href: dashboardHref(locale, ev.id),
    draft: ev.status === 'draft',
  }))
}
