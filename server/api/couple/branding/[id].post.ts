import type { Database } from '~/types/database.types'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

/**
 * POST /api/couple/branding/[id] — upsert branding for an event.
 *
 * Multipart body so we can carry an optional cover-photo file:
 *   - bride_name      string
 *   - groom_name      string
 *   - accent_color    string (hex #rrggbb)
 *   - greeting_text   string
 *   - cover_photo     file (optional, replaces existing)
 *
 * Caller must own the event. The cover photo lands in the public
 * `branding` bucket at `branding://{event_id}/cover-{uuid}.{ext}`.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, owner_id')
    .eq('id', id!)
    .maybeSingle()
  if (!ev)
    fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub))
    fail(403, 'forbidden')

  const form = await readMultipartFormData(event)
  if (!form)
    fail(400, 'missing_body')

  const fields = new Map<string, string>()
  let cover: { type?: string, data: Buffer } | null = null
  for (const part of form!) {
    if (part.name === 'cover_photo' && part.data && part.data.length > 0) {
      cover = { type: part.type, data: part.data }
    }
    else if (part.name && part.data) {
      fields.set(part.name, part.data.toString('utf8'))
    }
  }

  const schema = z.object({
    bride_name: z.string().max(80).optional(),
    groom_name: z.string().max(80).optional(),
    accent_color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    greeting_text: z.string().max(400).optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(fields))
  if (!parsed.success)
    fail(422, 'invalid_input')

  let coverPath: string | null = null
  if (cover) {
    if (!ALLOWED_MIME.has(cover.type ?? ''))
      fail(415, 'unsupported_mime')
    if (cover.data.length > 8 * 1024 * 1024)
      fail(413, 'file_too_large')
    const ext = cover.type === 'image/png' ? 'png' : cover.type === 'image/webp' ? 'webp' : 'jpg'
    coverPath = `${ev!.id}/cover-${randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('branding')
      .upload(coverPath, cover.data, { contentType: cover.type, upsert: false })
    if (upErr) {
      console.error('[branding] upload', upErr)
      fail(500, 'upload_failed')
    }
  }

  const { data: pub } = coverPath
    ? admin.storage.from('branding').getPublicUrl(coverPath)
    : { data: null as any }

  const update: any = {
    event_id: ev!.id,
    bride_name: parsed.data.bride_name ?? null,
    groom_name: parsed.data.groom_name ?? null,
    accent_color: parsed.data.accent_color ?? null,
    greeting_text: parsed.data.greeting_text ?? null,
  }
  if (pub?.publicUrl)
    update.cover_photo = pub.publicUrl

  const { error: upsertErr } = await admin
    .from('branding')
    .upsert(update, { onConflict: 'event_id' })
  if (upsertErr) {
    console.error('[branding] upsert', upsertErr)
    fail(500, 'save_failed')
  }

  return { ok: true, cover_photo: pub?.publicUrl ?? null }
})
