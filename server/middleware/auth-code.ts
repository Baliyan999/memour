import { serverSupabaseClient } from '#supabase/server'
import { confirmEmailConsent } from '../utils/consent'

/**
 * The couple's email login link, finished on the server.
 *
 * /api/auth/email/send asks GoTrue for the link (PKCE): the verifier
 * stays in a cookie of the browser that asked, and the link from the
 * email comes back through GoTrue as /{locale}/dashboard?code=<code>.
 * No page may see that request first — the auth middleware would send
 * a visitor without a session to the login page and the code would be
 * lost with the query. So the code is swapped for a session here: the
 * session cookies go out with a redirect to the same page without it,
 * and the dashboard renders logged in, in the link's language.
 *
 * A code that can't be swapped lands on the login page with
 * #error_code=…, which says so on the email tab: opened in another
 * browser than the one that asked (no verifier cookie), or refused by
 * GoTrue (used, expired).
 */
const CALLBACK = /^\/(uz|ru)\/dashboard\/?$/

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET') return
  const url = getRequestURL(event)
  const code = url.searchParams.get('code')
  const match = code ? CALLBACK.exec(url.pathname) : null
  if (!code || !match) return
  const locale = match[1] as 'uz' | 'ru'

  const supabase = await serverSupabaseClient(event)
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.session) {
    const reason = error?.code ?? 'invalid_code'
    console.warn('[auth/email] link code refused:', reason)
    return sendRedirect(event, `/${locale}/dashboard/login#error=access_denied&error_code=${encodeURIComponent(reason)}`, 303)
  }

  // The consent was recorded when the link was requested; the account
  // that opened it confirms it. A failure here doesn't undo the login.
  await confirmEmailConsent(event, { userId: data.user.id, email: data.user.email ?? null, locale }).catch((e) => {
    console.error('[auth/email] consent confirmation failed', e)
  })

  return sendRedirect(event, `/${locale}/dashboard`, 303)
})
