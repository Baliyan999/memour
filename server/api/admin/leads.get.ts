import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../utils/errors'

/**
 * GET /api/admin/leads — list incoming leads with optional status
 * filter. Admin-only. Most recent first, at most LIMIT rows, plus
 * per-status counts over all leads.
 */
const LIMIT = 500

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user) fail(401, 'unauthorized')

  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', ((user as any).id ?? (user as any).sub))
    .maybeSingle()
  if (!adminRow) fail(403, 'forbidden')

  const query = getQuery(event)
  const status = typeof query.status === 'string' ? query.status : null

  // The list is capped, so the filter chips' numbers come from count
  // queries over the whole table, not from the rows we send back.
  const STATUSES = ['new', 'contacted', 'won', 'lost'] as const
  const countFor = (s?: string) => {
    let c = admin.from('leads').select('id', { count: 'exact', head: true })
    if (s) c = c.eq('status', s)
    return c
  }
  const [total, ...perStatus] = await Promise.all([countFor(), ...STATUSES.map((s) => countFor(s))])
  const counts = Object.fromEntries(STATUSES.map((s, i) => [s, perStatus[i]?.count ?? 0]))

  let q = admin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (status && (STATUSES as readonly string[]).includes(status)) {
    q = q.eq('status', status)
  }
  const { data, error } = await q
  if (error) fail(500, 'list_failed')
  return { leads: data ?? [], counts, total: total.count ?? 0, limit: LIMIT }
})
