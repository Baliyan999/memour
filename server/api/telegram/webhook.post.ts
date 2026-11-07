import type { H3Event } from 'h3'
import { fail } from '../../utils/errors'
import { handleTelegramUpdate, webhookSecretMatches } from '../../utils/telegram-couple'

/**
 * POST /api/telegram/webhook — updates for the Memour bot, set up by
 * scripts/telegram-setup.mjs (setWebhook with secret_token and
 * allowed_updates message + my_chat_member).
 *
 * Telegram proves itself with X-Telegram-Bot-Api-Secret-Token, compared
 * in constant time with TELEGRAM_WEBHOOK_SECRET. Fails closed: without
 * the variable the endpoint answers 503 and reads nothing; a missing or
 * wrong header gets 401 before the body is read.
 *
 * A valid request is answered 200 at once and handled after that
 * (server/utils/telegram-couple.ts → handleTelegramUpdate): Telegram
 * only needs to know it arrived, and a slow database or sendMessage
 * must not make it retry. Other update types are acknowledged and
 * dropped. Nothing from the update — least of all a link token — is
 * logged.
 */
const MAX_BODY_BYTES = 256 * 1024

/**
 * The update as JSON, or null when it isn't JSON or the client went
 * away. The cap is counted while reading, so a chunked body without
 * Content-Length can't get past it either; over the cap the connection
 * is dropped (413).
 */
async function readUpdate(event: H3Event): Promise<any> {
  const req = event.node.req
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of req) {
      const buf = chunk as Buffer
      total += buf.length
      if (total > MAX_BODY_BYTES) {
        req.destroy()
        fail(413, 'file_too_large')
      }
      chunks.push(buf)
    }
  } catch (e: any) {
    if (e?.data?.code) throw e
    return null
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

export default defineEventHandler(async (event) => {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) fail(503, 'telegram_unavailable')
  if (!webhookSecretMatches(getHeader(event, 'x-telegram-bot-api-secret-token'))) fail(401, 'unauthorized')

  const length = Number(getHeader(event, 'content-length') ?? 0)
  if (length > MAX_BODY_BYTES) fail(413, 'file_too_large')

  const update = await readUpdate(event)
  if (update && typeof update === 'object' && (update.message || update.my_chat_member)) {
    void handleTelegramUpdate(update)
  }
  return { ok: true }
})
