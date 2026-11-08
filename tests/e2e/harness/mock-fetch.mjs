// Preloaded into the app under test:
//   NODE_OPTIONS="--import <this file>" node .output/server/index.mjs
//
// Replaces the server's global fetch so that nothing leaves the machine:
//   - Eskiz (SMS) and Telegram are answered here, and every message is
//     appended as one JSON line to $E2E_MOCK_LOG, where tests read login
//     codes, 2FA codes and notifications;
//   - localhost / 127.0.0.1 (the local Supabase) pass through;
//   - anything else is refused and logged as BLOCKED.
// No real SMS or Telegram message can be sent from a server started with it.
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOG = process.env.E2E_MOCK_LOG || join(tmpdir(), 'memour-e2e-mock.jsonl')
const realFetch = globalThis.fetch
const LOCAL = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function record(entry) {
  appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n')
}

async function bodyToObject(body) {
  if (!body) return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch {
      return Object.fromEntries(new URLSearchParams(body))
    }
  }
  if (body instanceof FormData || body instanceof URLSearchParams) return Object.fromEntries(body.entries())
  return { raw: String(body) }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async function mockedFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  const isRequest = typeof input === 'object' && !(input instanceof URL)

  if (url.hostname === 'notify.eskiz.uz') {
    const body = await bodyToObject(init.body ?? (isRequest ? await input.clone().text() : undefined))
    if (url.pathname.endsWith('/auth/login')) return json({ message: 'token_generated', data: { token: 'e2e-eskiz-token' } })
    if (url.pathname.endsWith('/message/sms/send')) {
      record({ service: 'eskiz', to: body.mobile_phone, from: body.from, text: body.message })
      return json({ id: `e2e-${Date.now()}`, status: 'waiting', message: 'Waiting for SMS provider' })
    }
    record({ service: 'eskiz', unhandled: url.pathname })
    return json({ message: 'e2e mock: unhandled Eskiz path' }, 404)
  }

  if (url.hostname === 'api.telegram.org') {
    const body = await bodyToObject(init.body ?? (isRequest ? await input.clone().text() : undefined))
    record({ service: 'telegram', method: url.pathname.split('/').pop(), chat_id: body.chat_id, text: body.text })
    return json({ ok: true, result: { message_id: Date.now() } })
  }

  if (!LOCAL.has(url.hostname)) {
    record({ service: 'BLOCKED', url: url.origin + url.pathname, method: init.method || (isRequest ? input.method : 'GET') })
    throw new TypeError(`e2e: outbound request to ${url.hostname} blocked`)
  }
  return realFetch(input, init)
}

record({ service: 'harness', event: 'preload-active', pid: process.pid })
