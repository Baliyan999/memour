/**
 * Settings of an e2e run, all from the environment.
 *
 * Supabase — the names `npx supabase status -o env` prints, so a shell can
 * export its output as is (`set -a; eval "$(npx supabase status -o env)"; set +a`):
 *   API_URL            http://127.0.0.1:54321
 *   ANON_KEY           anon key of the local stack
 *   SERVICE_ROLE_KEY   service-role key of the local stack (seeding, cleanup)
 *
 * Optional:
 *   E2E_PORT               port of the app under test (default 3100)
 *   E2E_MAILPIT_URL        Mailpit of the local stack (default http://127.0.0.1:54324)
 *   E2E_CHROMIUM_CHANNEL   e.g. "chrome" to use an installed Google Chrome
 *                          instead of Playwright's Chromium
 *
 * Tests never touch production: every URL must point at this machine.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const SERVER_ENTRY = join(ROOT, '.output', 'server', 'index.mjs')
export const MOCK_FETCH = join(ROOT, 'tests', 'e2e', 'harness', 'mock-fetch.mjs')
/** Logs of the run: the app's stdout/stderr and every mocked outbound call. */
export const RUN_DIR = join(ROOT, 'test-results', 'e2e-run')
export const SERVER_LOG = join(RUN_DIR, 'server.log')
export const MOCK_LOG = join(RUN_DIR, 'mock.jsonl')

export const PORT = Number(process.env.E2E_PORT || 3100)
/** What the browser opens. localhost (not 127.0.0.1): cookies and the auth redirect allow-lists use it. */
export const BASE_URL = `http://localhost:${PORT}`
export const MAILPIT_URL = (process.env.E2E_MAILPIT_URL || 'http://127.0.0.1:54324').replace(/\/+$/, '')

/** Fake chat the app sends lead alerts to (Telegram is mocked). */
export const LEAD_CHAT_ID = '100000001'
export const BOT_USERNAME = 'MemourE2EBot'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

export function isLocalUrl(url: string | URL): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

export interface SupabaseEnv {
  url: string
  anonKey: string
  serviceKey: string
}

/** Supabase settings, or a clear error naming what is missing. */
export function supabaseEnv(): SupabaseEnv {
  const missing = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'].filter((k) => !process.env[k])
  if (missing.length) {
    throw new Error(
      `e2e: ${missing.join(', ')} not set. Start the local stack (npx supabase start) and export its keys:\n`
      + '  set -a; eval "$(npx supabase status -o env)"; set +a',
    )
  }
  const url = process.env.API_URL!.replace(/\/+$/, '')
  if (!isLocalUrl(url)) {
    throw new Error(`e2e: API_URL=${url} is not on this machine. These tests seed and delete data; they run only against a local Supabase.`)
  }
  return { url, anonKey: process.env.ANON_KEY!, serviceKey: process.env.SERVICE_ROLE_KEY! }
}

/** The checks that need neither the network nor a browser. */
export function preflight(): SupabaseEnv {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`e2e: ${SERVER_ENTRY} not found. The tests run the built app — run \`pnpm build\` first.`)
  }
  if (!isLocalUrl(MAILPIT_URL)) throw new Error(`e2e: E2E_MAILPIT_URL=${MAILPIT_URL} is not on this machine.`)
  return supabaseEnv()
}
