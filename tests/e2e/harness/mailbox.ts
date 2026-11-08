/**
 * The local stack's Mailpit (every auth email of `npx supabase start`
 * lands there), through its HTTP API:
 *   GET    /api/v1/search?query=…   list
 *   GET    /api/v1/message/{ID}     one message (Text, HTML)
 *   DELETE /api/v1/messages         { IDs: [...] }
 */
import { MAILPIT_URL } from './env'

interface Summary { ID: string; Created: string; To: { Address: string }[] }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}/api/v1${path}`, init).catch((e: Error) => {
    throw new Error(`e2e: Mailpit is not reachable at ${MAILPIT_URL} (${e.message}). It is part of \`npx supabase start\`; set E2E_MAILPIT_URL if it runs elsewhere.`)
  })
  if (!res.ok) throw new Error(`e2e: Mailpit ${init.method ?? 'GET'} ${path} → ${res.status}`)
  // DELETE answers a plain "ok".
  return ((res.headers.get('content-type') ?? '').includes('json') ? await res.json() : await res.text()) as T
}

/**
 * Newest message to `to`, waiting for it up to `timeoutMs`. Addresses
 * carry the test's unique prefix, so nothing else can match.
 */
export async function waitForMail(to: string, timeoutMs = 15_000): Promise<{ id: string; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { messages } = await api<{ messages: Summary[] }>(`/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`)
    const hit = messages
      .filter((m) => m.To.some((a) => a.Address.toLowerCase() === to.toLowerCase()))
      .sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0]
    if (hit) {
      const full = await api<{ Text: string; HTML: string }>(`/message/${hit.ID}`)
      return { id: hit.ID, text: full.Text ?? '', html: full.HTML ?? '' }
    }
    if (Date.now() > deadline) throw new Error(`e2e: no email to ${to} arrived in Mailpit`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export async function deleteMail(ids: string[]): Promise<void> {
  if (!ids.length) return
  await api('/messages', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) })
}

/** The GoTrue verify link in an auth email. */
export function verifyLink(mail: { text: string; html: string }): string {
  const source = `${mail.text}\n${mail.html}`.replace(/&amp;/g, '&')
  const m = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(source)
  if (!m) throw new Error('e2e: no /auth/v1/verify link in the email')
  return m[0]
}
