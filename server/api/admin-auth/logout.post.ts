import { clearAdminSession } from '../../utils/admin-session'

/**
 * POST /api/admin-auth/logout — drop the Telegram-2FA cookie. The
 * caller still signs out of Supabase itself (supabase.auth.signOut());
 * the cookie is bound to that session anyway, so it would be useless
 * afterwards — this just doesn't leave it lying around.
 */
export default defineEventHandler((event) => {
  clearAdminSession(event)
  return { ok: true }
})
