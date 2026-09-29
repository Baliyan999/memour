import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../../utils/errors'

/**
 * GET /api/couple/event/[id]/photos — one page of an event's media for
 * the owner's dashboard grid and the moderation queue.
 *
 * Query:
 *   filter  visible (default) | highlights | hidden | all
 *   table   only this guest table (combined with `filter`)
 *   cursor  opaque keyset cursor from the previous page's `next`
 *   limit   page size, 1–100 (default 60)
 *   counts  1 → also return per-filter totals (first page only), plus
 *           `guests`: guest devices bound to the event (the tier's
 *           guest limit counts these, shared/plans.ts)
 *
 * Newest first, keyset-paginated on (uploaded_at, id) so photos that
 * arrive while the couple scrolls don't shift or duplicate pages, and
 * nothing is lost to PostgREST's max_rows cap.
 *
 * Every item carries short-lived signed URLs, so hidden media (which
 * the public /api/photo endpoint refuses with 410) still renders for
 * its owner.
 */
const SIGN_TTL = 60 * 60 * 3 // 3 hours: covers a long moderation session

type Filter = 'visible' | 'highlights' | 'hidden' | 'all'

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const q = getQuery(event)
  const filter: Filter = ['highlights', 'hidden', 'all'].includes(String(q.filter))
    ? (String(q.filter) as Filter)
    : 'visible'
  const table = q.table ? Number.parseInt(String(q.table), 10) : null
  if (table !== null && !(Number.isFinite(table) && table > 0)) fail(422, 'invalid_input')
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(q.limit ?? 60), 10) || 60))

  let cursor: { ts: string; id: string } | null = null
  if (q.cursor) {
    try {
      const [ts, cid] = Buffer.from(String(q.cursor), 'base64url').toString('utf8').split('|')
      // Strict shapes only: both values end up inside a PostgREST filter.
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(ts ?? '')) throw new Error('bad cursor')
      if (!/^[0-9a-f-]{36}$/i.test(cid ?? '')) throw new Error('bad cursor')
      cursor = { ts: ts!, id: cid! }
    } catch {
      fail(422, 'invalid_input')
    }
  }

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')

  let rowsQ = admin
    .from('photos')
    .select('id, storage_path, thumbnail_path, media_type, mime_type, duration_ms, is_hidden, is_highlight, guest_name, guest_table, uploaded_at')
    .eq('event_id', id!)
  if (filter === 'visible') rowsQ = rowsQ.eq('is_hidden', false)
  if (filter === 'highlights') rowsQ = rowsQ.eq('is_hidden', false).eq('is_highlight', true)
  if (filter === 'hidden') rowsQ = rowsQ.eq('is_hidden', true)
  if (table) rowsQ = rowsQ.eq('guest_table', table)
  if (cursor) {
    // Quoted: the timestamp contains `:` `.` `+`, which PostgREST's
    // logic-tree syntax would otherwise try to parse.
    rowsQ = rowsQ.or(`uploaded_at.lt."${cursor.ts}",and(uploaded_at.eq."${cursor.ts}",id.lt.${cursor.id})`)
  }
  const { data: rows, error } = await rowsQ
    .order('uploaded_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[couple/photos] list', error)
    fail(500, 'list_failed')
  }

  // One batch sign for thumbnails + originals of the whole page. Only
  // objects inside this event's folder get a URL — a row pointing at
  // another event's file renders as an empty tile, never as that file.
  const own = (path: string | null): path is string => !!path && path.startsWith(`${id}/`)
  const paths = new Set<string>()
  for (const r of rows!) {
    if (own(r.storage_path)) paths.add(r.storage_path)
    if (own(r.thumbnail_path)) paths.add(r.thumbnail_path)
  }
  const signedBy = new Map<string, string>()
  if (paths.size) {
    const { data: signed, error: signErr } = await admin.storage
      .from('photos')
      .createSignedUrls([...paths], SIGN_TTL)
    if (signErr) {
      console.error('[couple/photos] sign', signErr)
      fail(500, 'sign_failed')
    }
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedBy.set(s.path, s.signedUrl)
    }
  }

  const items = rows!.map((r) => ({
    id: r.id,
    media_type: (r.media_type === 'video' || r.media_type === 'voice' ? r.media_type : 'photo') as 'photo' | 'video' | 'voice',
    mime_type: r.mime_type,
    duration_ms: r.duration_ms,
    is_hidden: r.is_hidden,
    is_highlight: r.is_highlight,
    guest_name: r.guest_name,
    guest_table: r.guest_table,
    uploaded_at: r.uploaded_at,
    url: signedBy.get(r.storage_path) ?? null,
    thumb_url: signedBy.get(own(r.thumbnail_path) ? r.thumbnail_path : r.storage_path) ?? null,
  }))

  const last = rows!.length === limit ? rows![rows!.length - 1] : null
  const next = last
    ? Buffer.from(`${last.uploaded_at}|${last.id}`, 'utf8').toString('base64url')
    : null

  if (!q.counts) return { items, next }

  // Totals come from COUNT(*) — never from the length of a page.
  const countWhere = (fn: (qb: any) => any) =>
    fn(admin.from('photos').select('id', { count: 'exact', head: true }).eq('event_id', id!))
      .then(({ count, error }: { count: number | null; error: unknown }) => {
        if (error) throw error
        return count ?? 0
      })
  try {
    const [total, hidden, highlights, video, voice, devices, guests] = await Promise.all([
      countWhere((qb) => qb),
      countWhere((qb) => qb.eq('is_hidden', true)),
      countWhere((qb) => qb.eq('is_hidden', false).eq('is_highlight', true)),
      countWhere((qb) => qb.eq('media_type', 'video')),
      countWhere((qb) => qb.eq('media_type', 'voice')),
      // Tables with at least one bound guest device — the table filter.
      admin.from('guest_devices').select('table_number').eq('event_id', id!).then(({ data, error }) => {
        if (error) throw error
        return data ?? []
      }),
      admin.from('guest_devices').select('device_id', { count: 'exact', head: true }).eq('event_id', id!).then(({ count, error }) => {
        if (error) throw error
        return count ?? 0
      }),
    ])
    const tables = [...new Set(devices.map((d) => d.table_number))].sort((a, b) => a - b)
    return {
      items,
      next,
      counts: { total, visible: total - hidden, hidden, highlights, video, voice, tables, guests },
    }
  } catch (err) {
    console.error('[couple/photos] counts', err)
    fail(500, 'list_failed')
  }
})
