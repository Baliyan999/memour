import { serverSupabaseUser } from '#supabase/server'
import type { H3Event } from 'h3'

/**
 * Returns the auth user's ID. @nuxtjs/supabase v2 returns the
 * decoded JWT claims object where the user id lives at `sub`, not
 * `.id` as the Supabase JS SDK User type advertises. Normalize that
 * here so every endpoint can just call `userId(event)`.
 *
 * Returns null when there's no authenticated user — including a
 * session GoTrue no longer accepts (expired / revoked refresh token),
 * which serverSupabaseUser reports by throwing a 500 with GoTrue's
 * English text.
 */
export async function userId(event: H3Event): Promise<string | null> {
  const u = (await serverSupabaseUser(event).catch(() => null)) as any
  if (!u) return null
  return u.id ?? u.sub ?? null
}
