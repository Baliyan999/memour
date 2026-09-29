import * as archiverModule from 'archiver'
import type { Archiver, ArchiverOptions } from 'archiver'
import { Readable } from 'node:stream'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { fail } from '../../../utils/errors'

/**
 * GET /api/couple/zip/[id] — stream a ZIP archive of every visible
 * photo, video and voice message of an event. Only the event's
 * owner_id (= logged-in user) can call.
 *
 * Query:
 *   ?check=1   — run the auth / ownership / "anything to download"
 *                checks and answer JSON { ok, count } instead of the
 *                archive. The dashboard calls this first so errors
 *                surface as a toast instead of a raw JSON page.
 *   ?lang=ru   — language of the folder names and the missing-files
 *                note inside the archive (default uz).
 *
 * Memory stays flat regardless of event size: rows are listed page by
 * page (PostgREST caps a single select at max_rows), and each file is
 * streamed from Storage straight into archiver. We wait for archiver's
 * `entry` event before appending the next file, so a slow client
 * pauses the Storage download instead of piling files up in RAM.
 *
 * Throughput: URLs are signed 100 at a time, and the next file's
 * download is opened while the current one streams (one file ahead —
 * its unread body sits in the socket buffer), so the client isn't left
 * waiting on a signing round trip + Storage TTFB between files.
 *
 * Media is already compressed (JPEG / MP4 / WebM / M4A), so entries
 * are STOREd — deflate would only burn CPU for ~0% gain.
 *
 * Entry name: `{folder}/{nnnn}_{table-N}_{guest}.{ext}` so the couple
 * can sort by upload order / table / guest in their file explorer.
 */
// archiver 8 is ESM with class exports only ({ ZipArchive, … }); the
// v7 `archiver('zip')` factory is gone and calling it throws. The
// types in @types/archiver still describe v7, hence the cast.
function createZip(options: ArchiverOptions): Archiver {
  const mod = archiverModule as any
  if (typeof mod.ZipArchive === 'function') return new mod.ZipArchive(options)
  return (mod.default ?? mod)('zip', options)
}

const PAGE = 1000
const DOWNLOAD_ATTEMPTS = 3
const SIGN_BATCH = 100
const SIGN_TTL = 60 * 60
// A prefetched download that waited longer than this (slow client,
// huge current file) is dropped and reopened: an idle half-read
// connection may be cut by a proxy along the way.
const PREFETCH_MAX_IDLE_MS = 20_000

const FOLDERS = {
  uz: { photo: 'suratlar', video: 'videolar', voice: 'ovozli-xabarlar' },
  ru: { photo: 'фото', video: 'видео', voice: 'голосовые' },
} as const

const MISSING_NOTE = {
  uz: 'Bu fayllarni arxivga qoʻshib boʻlmadi. Birozdan soʻng arxivni qayta yuklab oling.',
  ru: 'Эти файлы не удалось добавить в архив. Скачайте архив ещё раз чуть позже.',
} as const

// Fallback extension when a legacy storage_path has none.
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
}

/** Letters (any script, incl. Uzbek ʻ ʼ), digits, space, dash, & — everything else → _ */
function cleanPart(s: string, max: number) {
  return s.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}ʻʼ'& -]+/gu, '_').trim().slice(0, max)
}

type Row = Pick<
  Database['public']['Tables']['photos']['Row'],
  'id' | 'storage_path' | 'guest_name' | 'guest_table' | 'mime_type' | 'media_type' | 'uploaded_at'
>

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const query = getQuery(event)
  const lang = query.lang === 'ru' ? 'ru' : 'uz'

  const admin = serverSupabaseServiceRole<Database>(event)

  // Verify ownership.
  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')

  if (query.check) {
    const { count, error } = await admin
      .from('photos')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id!)
      .eq('is_hidden', false)
    if (error) fail(500, 'list_failed')
    if (!count) fail(404, 'no_photos')
    return { ok: true, count }
  }

  // List every visible row. Keep paging until an EMPTY page — a short
  // page is not proof of the end when max_rows is below PAGE.
  const rows: Row[] = []
  const seen = new Set<string>()
  for (let from = 0; ; ) {
    const { data, error } = await admin
      .from('photos')
      .select('id, storage_path, guest_name, guest_table, mime_type, media_type, uploaded_at')
      .eq('event_id', id!)
      .eq('is_hidden', false)
      .order('uploaded_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) fail(500, 'list_failed')
    if (!data || data.length === 0) break
    for (const r of data) {
      // Only objects inside this event's folder: a row pointing elsewhere
      // must not become a way to download another event's files.
      if (!r.storage_path.startsWith(`${id}/`)) {
        console.error('[zip] foreign storage_path skipped', r.id)
        continue
      }
      if (!seen.has(r.id)) {
        seen.add(r.id)
        rows.push(r)
      }
    }
    from += data.length
  }
  if (rows.length === 0) fail(404, 'no_photos')

  // Header values must be Latin-1: plain ASCII fallback + RFC 5987
  // filename* carrying the real (often Cyrillic) couple names.
  const utf8Name = `memour-${cleanPart(ev!.couple_names, 60) || 'album'}.zip`
  const asciiName = `memour-${ev!.couple_names.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'album'}.zip`
  setResponseHeaders(event, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`,
    'Cache-Control': 'no-store',
    // nginx: pass the stream through instead of spooling it to disk.
    'X-Accel-Buffering': 'no',
  })

  const archive = createZip({ store: true })
  const res = event.node.res
  const abort = new AbortController()
  let finished = false
  res.on('close', () => {
    // Client went away mid-download: stop pulling from Storage.
    if (!finished) {
      abort.abort()
      archive.abort()
    }
  })

  // Signed URLs for a whole batch of rows in one Storage call. A path
  // missing from the result (object gone, batch call failed) is simply
  // signed on its own in openSource.
  const signedUrls = new Map<string, string>()
  const signedBatches = new Set<number>()
  async function signBatchOf(index: number) {
    const batch = Math.floor(index / SIGN_BATCH)
    if (signedBatches.has(batch)) return
    signedBatches.add(batch)
    const paths = rows.slice(batch * SIGN_BATCH, (batch + 1) * SIGN_BATCH).map((r) => r.storage_path)
    try {
      const { data } = await admin.storage.from('photos').createSignedUrls(paths, SIGN_TTL)
      for (const s of data ?? []) {
        if (s.path && s.signedUrl && !s.error) signedUrls.set(s.path, s.signedUrl)
      }
    } catch (err) {
      console.error('[zip] batch sign failed', err)
    }
  }

  const isNotFound = (err: any) => err?.statusCode === '404' || /not.?found/i.test(String(err?.message ?? ''))

  // Open a Storage download, retrying transient failures (5xx, network,
  // an expired signature). "Object not found" is final — no retries.
  // Returns null when the file is gone or stays unreachable.
  //
  // The body is wrapped in a Node stream right away: that locks it, and
  // undici cancels an UNLOCKED body once its Response is garbage
  // collected — a prefetched file would then end early, as an empty
  // entry in a ZIP that still tests OK. The no-op error listener keeps
  // an abort while the stream waits its turn from crashing the process;
  // the loop checks `errored` before appending.
  async function openSource(path: string): Promise<{ stream: Readable; at: number } | null> {
    let url = signedUrls.get(path)
    signedUrls.delete(path)
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      if (abort.signal.aborted) return null
      try {
        if (!url) {
          const { data: signed, error } = await admin.storage.from('photos').createSignedUrl(path, SIGN_TTL)
          if (error && isNotFound(error)) return null
          if (error || !signed?.signedUrl) throw error ?? new Error('no signed url')
          url = signed.signedUrl
        }
        const r = await fetch(url, { signal: abort.signal })
        if (r.ok && r.body) {
          const stream = Readable.fromWeb(r.body as any)
          stream.on('error', () => {})
          return { stream, at: Date.now() }
        }
        const text = await r.text().catch(() => '')
        if (r.status === 404 || /not.?found/i.test(text)) return null
        url = undefined // expired / rejected signature → sign again
        if (r.status >= 400 && r.status < 500) continue
      } catch (err) {
        if (abort.signal.aborted) return null
        console.error('[zip] download attempt failed', path, attempt, err)
        url = undefined
      }
      await new Promise((r) => setTimeout(r, 400 * attempt))
    }
    return null
  }

  // Resolve once archiver has consumed the whole source into the
  // archive — this is what gives us backpressure between files.
  function appendAndWait(source: Readable | string, data: { name: string; date?: Date }) {
    return new Promise<void>((resolve, reject) => {
      const done = (err?: unknown) => {
        archive.off('entry', onEntry)
        archive.off('error', done)
        if (typeof source !== 'string') source.off('error', done)
        if (err) reject(err)
        else resolve()
      }
      const onEntry = () => done()
      archive.on('entry', onEntry)
      archive.on('error', done)
      if (typeof source !== 'string') source.on('error', done)
      archive.append(source, data)
    })
  }

  ;(async () => {
    const missing: string[] = []
    try {
      const prefetch = (index: number) =>
        signBatchOf(index).then(() => openSource(rows[index]!.storage_path))
      let next = prefetch(0)
      for (const [index, p] of rows.entries()) {
        if (abort.signal.aborted) return
        let opened = await next
        next = index + 1 < rows.length ? prefetch(index + 1) : Promise.resolve(null)
        if (opened && (opened.stream.errored || Date.now() - opened.at > PREFETCH_MAX_IDLE_MS)) {
          opened.stream.destroy()
          opened = await openSource(p.storage_path)
        }
        const kind = p.media_type === 'video' || p.media_type === 'voice' ? p.media_type : 'photo'
        const pathExt = /\.([a-z0-9]{2,5})$/i.exec(p.storage_path)?.[1]?.toLowerCase()
        const ext = pathExt ?? EXT_BY_MIME[p.mime_type ?? ''] ?? 'bin'
        const parts = [
          String(index + 1).padStart(4, '0'),
          p.guest_table ? `table-${p.guest_table}` : null,
          p.guest_name ? cleanPart(p.guest_name, 30) : null,
        ].filter(Boolean)
        const name = `${FOLDERS[lang][kind]}/${parts.join('_')}.${ext}`

        if (!opened) {
          if (abort.signal.aborted) return
          console.error('[zip] giving up on', p.storage_path)
          missing.push(name)
          continue
        }
        await appendAndWait(opened.stream, { name, date: new Date(p.uploaded_at) })
      }
      if (missing.length) {
        await appendAndWait(`${MISSING_NOTE[lang]}\n\n${missing.join('\n')}\n`, {
          name: lang === 'ru' ? 'не-добавленные-файлы.txt' : 'qoʻshilmagan-fayllar.txt',
        })
      }
      await archive.finalize()
      finished = true
    } catch (err) {
      if (abort.signal.aborted) return
      console.error('[zip] fatal', err)
      abort.abort()
      archive.abort()
      // Kill the connection instead of ending it cleanly, so the
      // browser marks the download as failed rather than saving a
      // truncated archive that looks complete.
      res.destroy(err as Error)
    }
  })()

  return sendStream(event, archive)
})
