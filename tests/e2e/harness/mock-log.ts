/**
 * What the app tried to send out during the run, as recorded by
 * mock-fetch.mjs (one JSON object per line in MOCK_LOG).
 */
import { readFileSync } from 'node:fs'
import { MOCK_LOG } from './env'

export interface MockMessage {
  ts: string
  service: 'telegram' | 'eskiz' | 'BLOCKED' | 'harness'
  method?: string
  chat_id?: string | number
  to?: string
  text?: string
  url?: string
}

export function mockMessages(): MockMessage[] {
  return readFileSync(MOCK_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as MockMessage)
}

/** The first recorded message `match` accepts, waiting for it up to `timeoutMs`. */
export async function waitForMock(match: (m: MockMessage) => boolean, timeoutMs = 10_000): Promise<MockMessage> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = mockMessages().find(match)
    if (hit) return hit
    if (Date.now() > deadline) throw new Error('e2e: the expected outbound message was not recorded by the mock')
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** A Telegram message to `chatId`. */
export const toTelegramChat = (chatId: string | number) => (m: MockMessage) =>
  m.service === 'telegram' && String(m.chat_id) === String(chatId)
