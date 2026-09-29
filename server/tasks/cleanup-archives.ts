import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database, Json } from '~/types/database.types'

/**
 * Nitro task `cleanup-archives` — retention purge.
 *
 * Deletes the media of events whose `archive_expires_at` has passed
 * (wedding_date + 180 days, 365 for Luxury — set by the
 * `set_event_archive_expiry` trigger), so the privacy-policy promise
 * "photos and videos are deleted automatically" actually holds:
 *
 *   1. every object under `{event_id}/` in the private `photos` bucket
 *      (originals, thumbs, videos, voice) and in the public `branding`
 *      bucket (cover photo, QR logo) — through the Storage API, never
 *      a raw DELETE on storage.objects, so the files really go away;
 *   2. the event's `photos` rows;
 *   3. the dangling references (branding.cover_photo,
 *      events.qr_settings.logo_path), then stamps events.purged_at.
 *
 * The event row, its branding text and its payments stay: they are
 * business records, not guest media.
 *
 * Only events that are no longer 'active' are touched: pg_cron's
 * archive_expired_events() flips expired events to 'archived' every
 * hour, and a purge never races a live upload.
 *
 * DRY RUN unless RETENTION_PURGE_ENABLED === 'true': it lists what it
 * would delete and logs it, nothing more. Storage failures leave the
 * event unstamped, so the next run retries it; the run itself moves on
 * to the next event, so one that keeps failing never blocks the rest.
 *
 * Scheduled from nuxt.config (nitro.scheduledTasks); in dev it can be
 * run by hand: GET /_nitro/tasks/cleanup-archives
 */

// Events purged per run (also the page size) — keeps one run short;
// the rest go on the next run.
const EVENTS_PER_RUN = 25
// Storage list() page size.
const LIST_PAGE = 1000
// Paths per Storage remove() call.
const REMOVE_CHUNK = 100

const BUCKETS = ['photos', 'branding'] as const

type Admin = ReturnType<typeof serverSupabaseServiceRole<Database>>

/** Every object path under `prefix`, walking sub-folders, page by page. */
async function listAll(admin: Admin, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw error
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`
      // Folders come back with a null id; files carry one.
      if (entry.id === null) paths.push(...(await listAll(admin, bucket, path)))
      else paths.push(path)
    }
    if (!data || data.length < LIST_PAGE) return paths
  }
}

export default defineTask({
  meta: {
    name: 'cleanup-archives',
    description: 'Delete media of events past archive_expires_at (dry run unless RETENTION_PURGE_ENABLED=true)',
  },
  async run() {
    const dryRun = process.env.RETENTION_PURGE_ENABLED !== 'true'
    // serverSupabaseServiceRole() only needs an event for its
    // per-request client cache and runtime config; a scheduled task has
    // no request, so it gets a bare one.
    const admin = serverSupabaseServiceRole<Database>(
      { context: { nitro: {} } } as unknown as Parameters<typeof serverSupabaseServiceRole>[0],
    )

    const summary = { dryRun, events: 0, objects: 0, rows: 0, failed: 0 }
    const now = new Date().toISOString()

    // Keyset over (archive_expires_at, id): each page starts after the
    // last event this run has looked at, so events that fail every time
    // are tried once per run and never hold back the ones behind them.
    let after: { at: string; id: string } | null = null
    pages: while (summary.events < EVENTS_PER_RUN) {
      let query = admin
        .from('events')
        .select('id, archive_expires_at, qr_settings')
        .lt('archive_expires_at', now)
        .is('purged_at', null)
        .neq('status', 'active')
        .order('archive_expires_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(EVENTS_PER_RUN)
      if (after) {
        query = query.or(
          `archive_expires_at.gt."${after.at}",and(archive_expires_at.eq."${after.at}",id.gt.${after.id})`,
        )
      }
      const { data: events, error } = await query
      if (error) {
        console.error('[retention] event query failed', error)
        summary.failed++
        break
      }

      type Candidate = { id: string; archive_expires_at: string; qr_settings: { [key: string]: Json | undefined } | null }
      for (const ev of (events ?? []) as Candidate[]) {
        if (summary.events >= EVENTS_PER_RUN) break pages
        after = { at: ev.archive_expires_at, id: ev.id }
        try {
          const objects: Record<string, string[]> = {}
          for (const bucket of BUCKETS) objects[bucket] = await listAll(admin, bucket, ev.id)
          const { count: rows } = await admin
            .from('photos')
            .select('id', { count: 'exact', head: true })
            .eq('event_id', ev.id)
          const objectCount = BUCKETS.reduce((n, b) => n + objects[b]!.length, 0)

          if (!dryRun) {
            for (const bucket of BUCKETS) {
              const paths = objects[bucket]!
              for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
                const { error: rmErr } = await admin.storage
                  .from(bucket)
                  .remove(paths.slice(i, i + REMOVE_CHUNK))
                if (rmErr) throw rmErr
              }
            }
            const { error: delErr } = await admin.from('photos').delete().eq('event_id', ev.id)
            if (delErr) throw delErr
            const { error: brErr } = await admin
              .from('branding')
              .update({ cover_photo: null })
              .eq('event_id', ev.id)
            if (brErr) throw brErr
            const { logo_path: _logo, ...qrSettings } = ev.qr_settings ?? {}
            const { error: evErr } = await admin
              .from('events')
              .update({ purged_at: new Date().toISOString(), qr_settings: qrSettings })
              .eq('id', ev.id)
            if (evErr) throw evErr
          }

          console.info(
            `[retention] ${dryRun ? 'dry run, would purge' : 'purged'} event ${ev.id}: ` +
              `${objectCount} objects, ${rows ?? 0} photo rows`,
          )
          summary.events++
          summary.objects += objectCount
          summary.rows += rows ?? 0
        } catch (e) {
          // Left unstamped — the next run picks it up again.
          console.error(`[retention] event ${ev.id} failed`, e)
          summary.failed++
        }
      }
      if ((events?.length ?? 0) < EVENTS_PER_RUN) break
    }

    console.info('[retention] done', summary)
    return { result: summary }
  },
})
