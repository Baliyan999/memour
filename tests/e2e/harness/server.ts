/**
 * Starts the built app (.output/server/index.mjs) for one e2e run, with
 * the fetch mock preloaded, and stops it by its pid afterwards.
 *
 * The app gets a hand-built environment, not this shell's: whatever
 * real tokens a developer has exported never reach it. Telegram and
 * Eskiz get fake credentials and are answered by mock-fetch.mjs anyway.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  BASE_URL,
  BOT_USERNAME,
  LEAD_CHAT_ID,
  MOCK_FETCH,
  MOCK_LOG,
  PORT,
  ROOT,
  RUN_DIR,
  SERVER_ENTRY,
  SERVER_LOG,
  type SupabaseEnv,
} from './env'

const READY_TIMEOUT_MS = 30_000

function appEnv(sb: SupabaseEnv): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'SYSTEMROOT']
  const base = Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]]))
  return {
    ...base,
    NODE_ENV: 'production',
    NODE_OPTIONS: `--import=${pathToFileURL(MOCK_FETCH).href}`,
    E2E_MOCK_LOG: MOCK_LOG,
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
    PORT: String(PORT),
    NITRO_PORT: String(PORT),
    NUXT_PUBLIC_SITE_URL: BASE_URL,
    NUXT_PUBLIC_SUPABASE_URL: sb.url,
    NUXT_PUBLIC_SUPABASE_KEY: sb.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: sb.serviceKey,
    NUXT_PUBLIC_SUPABASE_COOKIE_OPTIONS_SECURE: 'false',
    ADMIN_SESSION_SECRET: randomBytes(32).toString('hex'),
    TELEGRAM_BOT_TOKEN: 'e2e-fake-bot-token',
    TELEGRAM_BOT_USERNAME: BOT_USERNAME,
    TELEGRAM_LEAD_CHAT_ID: LEAD_CHAT_ID,
    TELEGRAM_WEBHOOK_SECRET: randomBytes(24).toString('hex'),
    TELEGRAM_DIGEST_WINDOW_SECONDS: '5',
    ESKIZ_BASE_URL: 'https://notify.eskiz.uz/api',
    ESKIZ_EMAIL: 'e2e@example.invalid',
    ESKIZ_PASSWORD: 'e2e-fake-password',
    ESKIZ_SENDER: '4546',
    ESKIZ_USE_TEST_TEMPLATE: 'false',
  }
}

function tail(file: string, lines = 30): string {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n')
  } catch {
    return '(no log)'
  }
}

async function waitUntilReady(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`e2e: the app exited with code ${child.exitCode} while starting.\n${tail(SERVER_LOG)}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) return
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`e2e: the app did not answer /api/health within ${READY_TIMEOUT_MS / 1000}s.\n${tail(SERVER_LOG)}`)
}

/** Port free? A server already there would be tested instead of ours — and it has no mock. */
async function assertPortFree(): Promise<void> {
  const taken = await fetch(`http://127.0.0.1:${PORT}/`).then(() => true, () => false)
  if (taken) throw new Error(`e2e: something already listens on port ${PORT}. Stop it or pick another port with E2E_PORT.`)
}

export async function startApp(sb: SupabaseEnv): Promise<() => Promise<void>> {
  await assertPortFree()
  mkdirSync(RUN_DIR, { recursive: true })
  writeFileSync(MOCK_LOG, '')
  const log = openSync(SERVER_LOG, 'w')
  const child = spawn(process.execPath, [SERVER_ENTRY], { cwd: ROOT, env: appEnv(sb), stdio: ['ignore', log, log] })
  try {
    await waitUntilReady(child)
  } catch (e) {
    child.kill('SIGKILL')
    throw e
  }
  const preload = readFileSync(MOCK_LOG, 'utf8')
  if (!preload.includes('"preload-active"')) {
    child.kill('SIGKILL')
    throw new Error('e2e: the fetch mock did not load into the app; refusing to run without it.')
  }

  return async () => {
    if (child.exitCode !== null) return
    const exited = new Promise((r) => child.once('exit', r))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    await exited
    clearTimeout(timer)
  }
}
