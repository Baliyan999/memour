import { flushAllDigests } from '../utils/telegram-couple'

/**
 * Upload digests wait in memory for their window to close
 * (server/utils/telegram-couple.ts). On a graceful shutdown (deploy,
 * restart) Nitro calls the `close` hook: send what is pending instead
 * of losing it, within a few seconds — a restart must not hang on
 * Telegram.
 */
const FLUSH_BUDGET_MS = 8_000

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const n = await Promise.race([
      flushAllDigests(),
      new Promise<number>((resolve) => { timer = setTimeout(() => resolve(-1), FLUSH_BUDGET_MS) }),
    ])
    clearTimeout(timer)
    if (n !== 0) console.info(`[telegram-bot] shutdown: ${n < 0 ? 'digest flush timed out' : `${n} pending digest(s) sent`}`)
  })
})
