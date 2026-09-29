import { requireAdminSession } from '../../utils/admin-session'

/**
 * GET /api/admin-auth/status — does this browser have admin access
 * right now (session + completed Telegram 2FA + admins row)?
 *
 * Used by the global route middleware for /admin/* pages and by
 * /admin/login to skip the form. Answers 200 `{ ok, role }` or the same
 * error codes the admin API would (`unauthorized`, `admin_2fa_required`,
 * `not_admin`, `admin_auth_unavailable`).
 */
export default defineEventHandler(async (event) => {
  const { role } = await requireAdminSession(event)
  return { ok: true, role }
})
