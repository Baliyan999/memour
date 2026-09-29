import type { RouterConfig } from '@nuxt/schema'
// '#app/nuxt', not the '#app' barrel: importing the barrel here pulls
// the app entry into the router's module graph and the client bundle
// ends up reading getRouteRules before it's defined (every page 500s).
import { useNuxtApp } from '#app/nuxt'

// html { scroll-padding-top } clears the sticky header (5.5 → 8.5rem).
const headerOffset = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0

// html { scroll-behavior: smooth } (for the landing's #anchors) would
// also animate the scroll-to-top on page changes, so /privacy opened
// from the footer showed its bottom first and glided up. Same-page
// #anchors glide (CSS smooth); page changes land instantly — at the
// top, or at the #section when a legal page links back to one.
export default <RouterConfig>{
  scrollBehavior(to, from, saved) {
    const samePage = to.path.replace(/\/$/, '') === from.path.replace(/\/$/, '')
    if (samePage) {
      if (to.hash) return { el: to.hash, top: headerOffset() }
      return from.hash ? { left: 0, top: 0 } : false
    }
    const nuxtApp = useNuxtApp()
    return new Promise((resolve) => {
      // like Nuxt's default: wait until the new page has rendered
      nuxtApp.hooks.hookOnce('page:finish', () => {
        requestAnimationFrame(() => resolve(
          saved
            ?? (to.hash
              ? { el: to.hash, top: headerOffset(), behavior: 'instant' }
              : { left: 0, top: 0, behavior: 'instant' }),
        ))
      })
    })
  },
}
