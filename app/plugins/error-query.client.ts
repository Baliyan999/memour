/**
 * ?err=<code> → a toast in the page's language, then the parameter
 * leaves the address bar (a reload or a shared link won't repeat it).
 *
 * server/error.ts sends a tab that opened a failing /api link (photo,
 * ZIP, QR PDF) back to the page the link belongs to with ?err=<code>,
 * instead of leaving it on a raw error page.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    const router = useRouter()
    const route = router.currentRoute.value
    const code = route.query.err
    if (typeof code !== 'string') return
    const i18n = nuxtApp.$i18n as unknown as {
      t: (key: string, params?: Record<string, unknown>) => string
      te: (key: string) => boolean
    }
    useToast().toast.error(errorText(i18n.t, i18n.te, code))
    const { err: _, ...query } = route.query
    router.replace({ query, hash: route.hash })
  })
})
