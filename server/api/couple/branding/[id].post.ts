import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  serverSupabaseUser,
  serverSupabaseServiceRole,
} from '#supabase/server'
import type { Database } from '~/types/database.types'
import { tierHas } from '#shared/plans'
import { fail, failZod } from '../../../utils/errors'
import { sniffContainer } from '../../../utils/media-sniff'

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
 * Caller must own the event, and the event's tier must include the
 * guest-page design (Pro and up, shared/plans.ts) — else 403
 * not_in_plan, before the upload is even read.
 *
 * The cover photo lands in the public
 * `branding` bucket at `branding://{event_id}/cover-{uuid}.{ext}`,
 * re-encoded to at most 2000px (EXIF stripped) — every guest downloads
 * it on a phone, so a raw 8 MB camera original is not an option.
 */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event).catch(() => null)
  if (!user) fail(401, 'unauthorized')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) fail(400, 'invalid_id')

  const admin = serverSupabaseServiceRole<Database>(event)

  const { data: ev } = await admin
    .from('events')
    .select('id, owner_id, plan_tier')
    .eq('id', id!)
    .maybeSingle()
  if (!ev) fail(404, 'event_not_found')
  if (ev!.owner_id !== ((user as any).id ?? (user as any).sub)) fail(403, 'forbidden')
  if (!tierHas(ev!.plan_tier, 'branding')) fail(403, 'not_in_plan')

  const form = await readMultipartFormData(event)
  if (!form) fail(400, 'missing_body')

  const fields = new Map<string, string>()
  let cover: { type?: string; data: Buffer } | null = null
  for (const part of form!) {
    if (part.name === 'cover_photo' && part.data && part.data.length > 0) {
      cover = { type: part.type, data: part.data }
    } else if (part.name && part.data) {
      fields.set(part.name, part.data.toString('utf8'))
    }
  }

  const schema = z.object({
    bride_name: z.string().max(80).optional(),
    groom_name: z.string().max(80).optional(),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    greeting_text: z.string().max(400).optional(),
  })
  const parsed = schema.safeParse(Object.fromEntries(fields))
  if (!parsed.success) {
    failZod(parsed.error, {
      bride_name: 'name_too_long',
      groom_name: 'name_too_long',
      accent_color: 'invalid_color',
      greeting_text: 'greeting_too_long',
    })
  }

  let coverPath: string | null = null
  if (cover) {
    if (!ALLOWED_MIME.has(cover.type ?? '')) fail(415, 'unsupported_mime')
    if (cover.data.length > 8 * 1024 * 1024) fail(413, 'file_too_large')
    // The declared type is the client's word; only real JPEG / PNG /
    // WebP bytes reach sharp (no SVG, TIFF, HEIF… renamed to .png),
    // same allow-list as guest uploads.
    const container = sniffContainer(cover.data)
    if (container !== 'jpeg' && container !== 'png' && container !== 'webp') fail(415, 'unsupported_mime')
    // Opaque JPEG / PNG → JPEG. WebP, and anything with transparency (a
    // monogram or logo PNG), → WebP, which keeps the alpha channel.
    // limitInputPixels: a tiny PNG can declare 15000×15000 px and
    // decode into hundreds of MB.
    let asWebp = cover.type === 'image/webp'
    let body: Buffer
    try {
      const img = sharp(cover.data, { failOn: 'truncated', limitInputPixels: 40_000_000 })
      if ((await img.metadata()).hasAlpha) asWebp = true
      const pipeline = img
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      body = asWebp
        ? await pipeline.webp({ quality: 82 }).toBuffer()
        : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    } catch (e) {
      console.error('[branding] sharp', e)
      fail(415, 'unsupported_mime')
    }
    const ext = asWebp ? 'webp' : 'jpg'
    coverPath = `${ev!.id}/cover-${randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('branding')
      .upload(coverPath, body!, { contentType: asWebp ? 'image/webp' : 'image/jpeg', upsert: false })
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
  if (pub?.publicUrl) update.cover_photo = pub.publicUrl

  const { error: upsertErr } = await admin
    .from('branding')
    .upsert(update, { onConflict: 'event_id' })
  if (upsertErr) {
    console.error('[branding] upsert', upsertErr)
    fail(500, 'save_failed')
  }

  return { ok: true, cover_photo: pub?.publicUrl ?? null }
})
