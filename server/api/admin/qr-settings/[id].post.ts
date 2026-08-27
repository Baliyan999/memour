import type { Database } from '~/types/database.types'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  serverSupabaseServiceRole,
  serverSupabaseUser,
} from '#supabase/server'

/**
 * POST /api/admin/qr-settings/[id]
 *
 * Multipart body:
 *   - settings: JSON string of the QRSettings shape (style, layout,
 *     fg, bg, dot, corner, gradient, etc.)
 *   - logo: optional File — replaces the existing logo. If omitted
 *     we keep the previously stored logo_path. If `logo_remove=1` is
 *     in the form fields, we clear it.
 *
 * Admin only.
 */
function fail(statusCode: number, code: string): never {
  throw createError({ statusCode, statusMessage: code, data: { code } })
}

const settingsSchema = z.object({
  style: z.string().max(40).optional(),
  layout: z.enum(['2x2', '4x2', 'single']).optional(),
  dot: z.enum(['square', 'rounded', 'circle', 'classy']).optional(),
  corner: z.enum(['square', 'rounded', 'circle', 'leaf']).optional(),
  fg: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  bg: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  gradient: z
    .object({
      from: z.string().regex(/^#[0-9a-f]{6}$/i),
      to: z.string().regex(/^#[0-9a-f]{6}$/i),
      angle: z.number().min(0).max(360),
    })
    .nullable()
    .optional(),
  // logo_path is set server-side after upload; we don't accept it
  // from the client to avoid path injection.
}).strict()

const ALLOWED_LOGO_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export default defineEventHandler(async (event) => {
  const user = await serverSupabaseUser(event)
  if (!user)
    fail(401, 'unauthorized')
  const uid = (user as any).id ?? (user as any).sub
  const admin = serverSupabaseServiceRole<Database>(event)
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', uid)
    .maybeSingle()
  if (!adminRow)
    fail(403, 'forbidden')

  const id = getRouterParam(event, 'id')
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    fail(400, 'invalid_id')

  const { data: ev } = await admin
    .from('events')
    .select('id, qr_settings')
    .eq('id', id!)
    .maybeSingle()
  if (!ev)
    fail(404, 'event_not_found')

  const form = await readMultipartFormData(event)
  if (!form)
    fail(400, 'missing_body')

  let logoFile: { type?: string, data: Buffer } | null = null
  let removeLogo = false
  let settingsJson = '{}'
  for (const part of form!) {
    if (part.name === 'logo' && part.data && part.data.length > 0) {
      logoFile = { type: part.type, data: part.data }
    }
    else if (part.name === 'logo_remove' && part.data?.toString('utf8') === '1') {
      removeLogo = true
    }
    else if (part.name === 'settings' && part.data) {
      settingsJson = part.data.toString('utf8')
    }
  }

  let parsed
  try {
    parsed = settingsSchema.parse(JSON.parse(settingsJson))
  }
  catch {
    fail(422, 'invalid_settings')
  }

  // Handle logo upload / removal
  const prev = ((ev as any).qr_settings ?? {}) as Record<string, any>
  let logoPath: string | null = prev.logo_path ?? null

  if (logoFile) {
    if (!ALLOWED_LOGO_MIME.has(logoFile.type ?? ''))
      fail(415, 'unsupported_mime')
    if (logoFile.data.length > 4 * 1024 * 1024)
      fail(413, 'file_too_large')
    const ext = logoFile.type === 'image/jpeg'
      ? 'jpg'
      : logoFile.type === 'image/webp'
        ? 'webp'
        : logoFile.type === 'image/svg+xml'
          ? 'svg'
          : 'png'
    logoPath = `${id}/qr-logo-${randomUUID()}.${ext}`
    const { error: upErr } = await admin.storage
      .from('branding')
      .upload(logoPath, logoFile.data, { contentType: logoFile.type, upsert: false })
    if (upErr) {
      console.error('[qr-settings] logo upload', upErr)
      fail(500, 'upload_failed')
    }
  }
  else if (removeLogo) {
    logoPath = null
  }

  const nextSettings = {
    ...prev,
    ...parsed,
    logo_path: logoPath,
  }

  const { error } = await admin
    .from('events')
    .update({ qr_settings: nextSettings } as any)
    .eq('id', id!)
  if (error)
    fail(500, 'save_failed')

  return { ok: true, settings: nextSettings }
})
