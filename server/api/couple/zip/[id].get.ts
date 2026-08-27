import type { Database } from '~/types/database.types'
// archiver v8 ships as ESM with named exports only; default import
// breaks under Node's ESM module loader. Use createRequire to grab
// the CJS factory function (`archiver('zip', opts)`) unchanged.
import { createRequire } from 'node:module'
import { PassThrough } from 'node:stream'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')

/**
 * GET /api/couple/zip/[id] — stream a ZIP archive of all photos for
 * an event. Only the event's owner_id (= logged-in user) can call.
 *
 * Photos are pulled from Supabase Storage one by one as Blob and
 * piped into archiver, which streams the assembled ZIP to the
 * response. We don't buffer the whole archive in memory — events with
 * hundreds of photos would blow up the Nitro process otherwise.
 *
 * Filename inside the archive is `{table?-}{guest_name?-}{photo_id}.{ext}`
 * so the couple can sort by table / guest in their file explorer.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  // Verify ownership.
  const { data: ev } = await admin
    .from('events')
    .select('id, couple_names, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (!ev)
    fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub))
    fail(403, 'forbidden')

  const { data: photos, error: photosErr } = await admin
    .from('photos')
    .select('id, storage_path, guest_name, guest_table, mime_type')
    .eq('event_id', id!)
    .eq('is_hidden', false)
    .order('uploaded_at', { ascending: true })
  if (photosErr)
    fail(500, 'list_failed')
  if (!photos || photos.length === 0)
    fail(404, 'no_photos')

  // Set response headers BEFORE we start streaming.
  const safeName = ev!.couple_names.replace(/[^a-z0-9а-яё ]/gi, '_').slice(0, 40) || 'memour'
  setResponseHeader(event, 'Content-Type', 'application/zip')
  setResponseHeader(
    event,
    'Content-Disposition',
    `attachment; filename="memour-${safeName}.zip"`,
  )

  const archive = archiver('zip', { zlib: { level: 6 } })
  const pass = new PassThrough()
  archive.pipe(pass)

  // Kick off photo fetching/appending in the background; we'll
  // return the PassThrough to Nitro so it pipes as data arrives.
  ;(async () => {
    try {
      let i = 0
      for (const p of photos!) {
        i += 1
        const { data: blob, error } = await admin.storage
          .from('photos')
          .download(p.storage_path)
        if (error || !blob) {
          console.error('[zip] download failed', p.storage_path, error)
          continue
        }
        const ext = p.storage_path.split('.').pop() ?? 'jpg'
        const parts = [
          String(i).padStart(4, '0'),
          p.guest_table ? `table-${p.guest_table}` : null,
          p.guest_name ? p.guest_name.replace(/[^a-z0-9а-яё ]/gi, '_').slice(0, 30) : null,
        ].filter(Boolean)
        const name = `${parts.join('_')}.${ext}`
        const buf = Buffer.from(await blob.arrayBuffer())
        archive.append(buf, { name })
      }
      await archive.finalize()
    }
    catch (err) {
      console.error('[zip] fatal', err)
      archive.abort()
      pass.destroy(err as Error)
    }
  })()

  return sendStream(event, pass)
})
