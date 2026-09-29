/**
 * Global auth guard.
 *
 *   /dashboard/*  → requires any logged-in user (couple).
 *   /admin/*      → requires admin: logged in, finished the Telegram
 *                   2FA step for THIS session, and a row in
 *                   public.admins. Only the server can tell (the 2FA
 *                   proof is an httpOnly cookie), so we ask
 *                   /api/admin-auth/status.
 *
 * Login pages (/dashboard/login, /admin/login) are explicitly excluded
 * so anonymous visitors can reach them. Locale prefix (/ru, /uz) is
 * stripped before matching path patterns so the guard works on both.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const stripped = to.path.replace(/^\/(ru|uz)(?=\/|$)/, '') || '/'

  const isCoupleRoute =
    stripped.startsWith('/dashboard') &&
    !stripped.startsWith('/dashboard/login')

  const isAdminRoute =
    stripped.startsWith('/admin') && !stripped.startsWith('/admin/login')

  if (!isCoupleRoute && !isAdminRoute) return

  const user = useSupabaseUser()
  const localePath = useLocalePath()

  if (!user.value) {
    return navigateTo(localePath(isAdminRoute ? '/admin/login' : '/dashboard/login'))
  }

  // Admin gate. A plain Supabase session (email magic link, password
  // grant made directly against GoTrue) is not enough — the same check
  // guards every /api/admin/** call on the server. useRequestFetch
  // forwards the browser's cookies during SSR.
  if (isAdminRoute) {
    try {
      await useRequestFetch()('/api/admin-auth/status')
    } catch {
      return navigateTo(localePath('/admin/login'))
    }
  }
})
