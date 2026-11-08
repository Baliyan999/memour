#!/usr/bin/env node
/**
 * Point the Memour bot at this server and set up its profile.
 *
 *   cd /var/www/memour     # the live release on the server (docs/DEPLOY.md §7)
 *   node --env-file=.env scripts/telegram-setup.mjs --dry-run  # print, call nothing
 *   node --env-file=.env scripts/telegram-setup.mjs            # apply
 *   node --env-file=.env scripts/telegram-setup.mjs --info     # read-only status
 *
 * Needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and
 * NUXT_PUBLIC_SITE_URL (https — Telegram only calls https webhooks).
 *
 * Apply:
 *   - setWebhook: <site>/api/telegram/webhook with the secret Telegram
 *     sends back in X-Telegram-Bot-Api-Secret-Token, only the updates
 *     the bot handles (message, my_chat_member). Updates waiting in
 *     Telegram's queue are dropped only on the first setup (the webhook
 *     pointed elsewhere or nowhere — old updates meant for no one) or
 *     with --drop-pending. Otherwise they are kept: a couple who pressed
 *     Start while the server restarted still gets linked;
 *   - setMyName "Memour";
 *   - setMyDescription / setMyShortDescription in Uzbek and Russian
 *     (and a default for every other Telegram language);
 *   - setMyCommands /start, /stop, /help in both languages.
 *   Each profile item is read first and only set when it differs:
 *   Telegram rate-limits these edits hard. A 429 on one of them is a
 *   warning (it keeps the old text, run again later), not a failure.
 * Run it again after changing the secret or the site URL. The team's
 * alerts and admin codes are unaffected: they only send.
 *
 * --info prints getMe and getWebhookInfo (the URL Telegram calls, its
 * last error, pending updates). --dry-run prints every call with the
 * token and the secret masked and touches nothing.
 *
 * The token and the secret are never printed.
 */

const args = new Set(process.argv.slice(2))
const DRY = args.has('--dry-run')
const INFO = args.has('--info')
const DROP = args.has('--drop-pending')
const unknown = [...args].filter((a) => !['--dry-run', '--info', '--drop-pending'].includes(a))
if (unknown.length || (DRY && INFO) || (INFO && DROP)) {
  console.error('usage: node scripts/telegram-setup.mjs [--dry-run] [--drop-pending] | --info')
  process.exit(2)
}

const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
const site = String(process.env.NUXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '')

const problems = []
if (!token) problems.push('TELEGRAM_BOT_TOKEN is not set')
if (!INFO) {
  if (!secret) problems.push('TELEGRAM_WEBHOOK_SECRET is not set (openssl rand -hex 32)')
  else if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) problems.push('TELEGRAM_WEBHOOK_SECRET must be 16–256 characters of A–Z, a–z, 0–9, _ and -')
  if (!site) problems.push('NUXT_PUBLIC_SITE_URL is not set')
  else if (!site.startsWith('https://')) {
    const msg = `NUXT_PUBLIC_SITE_URL is ${site} — Telegram only calls https webhooks`
    if (DRY) console.warn(`warning: ${msg}`)
    else problems.push(msg)
  }
}
if (problems.length) {
  for (const p of problems) console.error(`error: ${p}`)
  process.exit(1)
}

const host = site.replace(/^https?:\/\//, '')

// ─── What the bot says about itself ──────────────────────────────────
// description: the empty chat before /start (≤ 512); short description:
// the profile and shared links (≤ 120); commands: the menu.
const PROFILE = {
  uz: {
    description:
      "Memour — to'yingiz mehmonlarining surat va videolari bitta albomda.\n\n"
      + "Bu bot juftlikka mehmonlarning yangi kadrlarini jamlab yuboradi, to'lov o'tganini aytadi va arxivni o'chirilishidan oldin yuklab olishni eslatadi.\n\n"
      + `Bildirishnomalar Memour kabinetida, to'y sahifasidagi «Telegramni ulash» tugmasi orqali ulanadi: ${host}`,
    short: "Mehmonlarning yangi kadrlari, to'lov va arxiv eslatmalari — Memour juftliklari uchun.",
    commands: [
      { command: 'start', description: 'Boshlash' },
      { command: 'stop', description: "Bildirishnomalarni o'chirish" },
      { command: 'help', description: 'Yordam' },
    ],
  },
  ru: {
    description:
      'Memour — фото и видео гостей вашей свадьбы в одном альбоме.\n\n'
      + 'Этот бот присылает паре сводку новых кадров от гостей, сообщает об оплате и напоминает скачать архив до удаления.\n\n'
      + `Уведомления подключаются в кабинете Memour — кнопкой «Подключить Telegram» на странице свадьбы: ${host}`,
    short: 'Новые кадры от гостей, оплата и напоминания об архиве — для пар Memour.',
    commands: [
      { command: 'start', description: 'Начать' },
      { command: 'stop', description: 'Отключить уведомления' },
      { command: 'help', description: 'Помощь' },
    ],
  },
}

const webhookUrl = `${site}/api/telegram/webhook`
const webhook = {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ['message', 'my_chat_member'],
  // Decided at run time: true on the first setup or with --drop-pending.
  drop_pending_updates: DROP,
}

// The bot's profile: [set method, its body]. Each has a getter
// (PROFILE_GET) so an unchanged item is not set again.
const calls = [
  ['setMyName', { name: 'Memour' }],
  // No language_code = everyone whose Telegram is in another language: Uzbek, the site's default.
  ['setMyDescription', { description: PROFILE.uz.description }],
  ['setMyShortDescription', { short_description: PROFILE.uz.short }],
  ['setMyCommands', { commands: PROFILE.uz.commands }],
]
for (const lang of ['uz', 'ru']) {
  calls.push(
    ['setMyDescription', { description: PROFILE[lang].description, language_code: lang }],
    ['setMyShortDescription', { short_description: PROFILE[lang].short, language_code: lang }],
    ['setMyCommands', { commands: PROFILE[lang].commands, language_code: lang }],
  )
}

/** The getter for a profile call and whether Telegram already has that value. */
const PROFILE_GET = {
  setMyName: ['getMyName', (r, b) => r?.name === b.name],
  setMyDescription: ['getMyDescription', (r, b) => r?.description === b.description],
  setMyShortDescription: ['getMyShortDescription', (r, b) => r?.short_description === b.short_description],
  setMyCommands: ['getMyCommands', (r, b) => JSON.stringify((r ?? []).map((c) => [c.command, c.description]))
    === JSON.stringify(b.commands.map((c) => [c.command, c.description]))],
}

for (const [method, body] of calls) {
  const text = body.description ?? body.short_description
  const limit = body.description ? 512 : 120
  if (text && text.length > limit) {
    console.error(`error: ${method}${body.language_code ? ` (${body.language_code})` : ''} is ${text.length} characters, Telegram allows ${limit}`)
    process.exit(1)
  }
}

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ description: e?.name === 'TimeoutError' ? 'timeout' : 'network error' }) }))
  const json = await res.json().catch(() => ({}))
  return {
    ok: res.ok && json.ok === true,
    status: res.status,
    result: json.result,
    description: json.description,
    retryAfter: json.parameters?.retry_after,
  }
}

const mask = (body) => JSON.stringify(body, (k, v) => (k === 'secret_token' ? `<${String(v).length} chars>` : v), 2)

if (DRY) {
  console.log('Dry run — nothing is sent. Bot token: <hidden>.\n')
  const shown = DROP ? webhook : { ...webhook, drop_pending_updates: '<true on the first setup (webhook not at this URL yet), else false; --drop-pending forces true>' }
  console.log(`setWebhook ${mask(shown)}\n`)
  console.log('Profile — each item is read first (getMy…) and set only when it differs:\n')
  for (const [method, body] of calls) console.log(`${method} ${mask(body)}\n`)
  process.exit(0)
}

if (INFO) {
  const me = await api('getMe')
  if (!me.ok) {
    console.error(`getMe failed: ${me.status} ${me.description ?? ''}`)
    process.exit(1)
  }
  console.log(`bot: @${me.result.username} (id ${me.result.id}, "${me.result.first_name}")`)
  const wh = await api('getWebhookInfo')
  if (!wh.ok) {
    console.error(`getWebhookInfo failed: ${wh.status} ${wh.description ?? ''}`)
    process.exit(1)
  }
  const w = wh.result ?? {}
  console.log(`webhook: ${w.url || '(none)'}`)
  console.log(`allowed updates: ${(w.allowed_updates ?? ['(default)']).join(', ')}`)
  console.log(`pending updates: ${w.pending_update_count ?? 0}`)
  if (w.last_error_date) {
    console.log(`last error: ${new Date(w.last_error_date * 1000).toISOString()} ${w.last_error_message ?? ''}`)
  }
  const expected = site ? `${site}/api/telegram/webhook` : null
  if (expected && w.url !== expected) console.warn(`warning: expected ${expected} — run this script without --info`)
  process.exit(0)
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 300))

// 1. The webhook. What is there now decides whether the queue goes.
const current = await api('getWebhookInfo')
if (!current.ok) {
  console.error(`FAIL getWebhookInfo: ${current.status} ${current.description ?? ''}`)
  process.exit(1)
}
const firstSetup = current.result?.url !== webhookUrl
const pending = current.result?.pending_update_count ?? 0
const drop = DROP || firstSetup
const wh = await api('setWebhook', { ...webhook, drop_pending_updates: drop })
if (!wh.ok) {
  console.error(`FAIL setWebhook: ${wh.status} ${wh.description ?? ''}`)
  process.exit(1)
}
console.log(`ok   setWebhook → ${webhookUrl} (${drop
  ? `${pending} pending update(s) dropped${DROP ? '' : ': first setup'}`
  : `${pending} pending update(s) kept`})`)

// 2. The profile: set only what differs; a rate limit is a warning.
let failed = 0
let warned = 0
for (const [method, body] of calls) {
  const label = `${method}${body.language_code ? ` (${body.language_code})` : ''}`
  const [getter, same] = PROFILE_GET[method]
  const now = await api(getter, body.language_code ? { language_code: body.language_code } : {})
  if (now.ok && same(now.result, body)) {
    console.log(`same ${label}`)
    continue
  }
  await pause()
  const r = await api(method, body)
  if (r.ok) console.log(`ok   ${label}`)
  else if (r.status === 429) {
    warned++
    console.warn(`wait ${label}: Telegram rate-limits profile edits — the old text stays; run again in ${r.retryAfter ?? '?'} s`)
  } else {
    failed++
    console.error(`FAIL ${label}: ${r.status} ${r.description ?? ''}`)
  }
  // setMyName and friends are rate-limited per bot; there's no hurry.
  await pause()
}
if (failed) {
  console.error(`${failed} call(s) failed.`)
  process.exit(1)
}
if (warned) console.warn(`\nThe webhook is set; ${warned} profile item(s) waiting on Telegram's rate limit — run the script again later.`)
console.log('\nDone. Check with: node scripts/telegram-setup.mjs --info')
