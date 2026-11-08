/**
 * Before any test: check the run can only touch this machine, that the
 * app is built and Supabase answers, then start the built app with the
 * fetch mock preloaded. Builds nothing. The returned function stops the
 * app (by its pid) after the last test.
 */
import { preflight } from './harness/env'
import { startApp } from './harness/server'

export default async function globalSetup(): Promise<() => Promise<void>> {
  const sb = preflight()

  const health = await fetch(`${sb.url}/rest/v1/events?select=id&limit=1`, {
    headers: { apikey: sb.serviceKey, Authorization: `Bearer ${sb.serviceKey}` },
  }).catch((e: Error) => {
    throw new Error(`e2e: Supabase at ${sb.url} is not reachable (${e.message}). Is the local stack running? (npx supabase start)`)
  })
  if (!health.ok) {
    throw new Error(`e2e: Supabase at ${sb.url} answered ${health.status} — wrong SERVICE_ROLE_KEY, or migrations not applied?`)
  }

  return startApp(sb)
}
