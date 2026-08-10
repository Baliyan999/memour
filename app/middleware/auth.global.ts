/**
 * Global auth guard.
 *
 *   /dashboard/*  → requires any logged-in user (couple).
 *   /admin/*      → requires admin: must be logged in AND have a row
 *                   in public.admins matching their user_id.
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

  // Admin gate: the logged-in user must also appear in public.admins.
  // On the server side useSupabaseUser() returns the raw JWT claims
  // (id lives at `.sub`), on the client it returns the Supabase User
  // object (with `.id`). Handle both shapes.
  if (isAdminRoute) {
    const uid = (user.value as any).id ?? (user.value as any).sub
    const supabase = useSupabaseClient()
    const { data, error } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle()
    if (error || !data) {
      return navigateTo(localePath('/admin/login'))
    }
  }
})
