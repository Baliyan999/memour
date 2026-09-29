import { requireAdminSession } from '../utils/admin-session'

/**
 * Gate for every /api/admin/** endpoint: the request needs the signed
 * Telegram-2FA cookie for the current Supabase session AND a row in
 * public.admins (see utils/admin-session.ts). A bare Supabase session —
 * email magic link, or a password grant made directly against GoTrue —
 * gets 401 `admin_2fa_required` before any handler runs.
 *
 * The handlers keep their own `admins` check; this runs first so a new
 * endpoint can't forget the second factor. The resolved admin is left
 * on `event.context.admin` for handlers that want it.
 *
 * Both the raw request path (what Nitro's router matches) and its
 * WHATWG-normalised form are checked, each decoded, with repeated
 * slashes collapsed and lower-cased: `/api/admin/%2e%2e/x` normalises
 * to `/api/x` but is still routed under /api/admin, while
 * `/api/x/../admin/y` is the reverse. Either one hitting the prefix is
 * enough.
 */
function normalise(path: string): string {
  try {
    path = decodeURIComponent(path)
  } catch {
    // Malformed escapes: match on the undecoded path.
  }
  return path.replace(/\/{2,}/g, '/').toLowerCase()
}

function isAdminApi(path: string): boolean {
  return path === '/api/admin' || path.startsWith('/api/admin/')
}

/** WHATWG path normalisation (dot segments, `%2e`, backslashes) against a fixed origin — the Host header plays no part. */
function whatwgPath(path: string): string {
  try {
    return new URL(path.replace(/^\/{2,}/, '/'), 'http://localhost').pathname
  } catch {
    return path
  }
}

export default defineEventHandler(async (event) => {
  const raw = event.path.split('?')[0] ?? ''
  if (!isAdminApi(normalise(raw)) && !isAdminApi(normalise(whatwgPath(raw)))) return

  event.context.admin = await requireAdminSession(event)
})
