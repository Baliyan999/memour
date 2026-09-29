import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../utils/errors'

/**
 * GET /api/health — health probe, no auth, no data in the response.
 *
 *   /api/health         liveness: 200 `{ ok: true }` whenever the Nitro
 *                       process answers. Never touches Supabase, so a
 *                       process watchdog pointed here doesn't restart a
 *                       healthy server (cutting off uploads, resetting
 *                       rate limits) while Supabase is down or paused.
 *   /api/health?deep=1  also runs a one-row query against Supabase:
 *                       503 `db_unavailable` when it fails or takes
 *                       longer than DB_TIMEOUT_MS. For the external
 *                       uptime monitor (alert only, never restart).
 */
// Well under a typical monitor timeout; no retries, so a down database
// answers 503 in this time instead of after supabase-js's backoff.
const DB_TIMEOUT_MS = 3000

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'no-store')
  if (getQuery(event).deep === undefined) return { ok: true }

  const admin = serverSupabaseServiceRole<Database>(event)
  const { error } = await admin
    .from('events')
    .select('id')
    .limit(1)
    .retry(false)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
  if (error) {
    console.error('[health] supabase', error)
    fail(503, 'db_unavailable')
  }

  return { ok: true }
})
