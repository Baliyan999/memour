/**
 * Drops Nuxt's `x-powered-by` banner from every response — it only
 * tells scanners what to aim at. The actual security headers are
 * routeRules in nuxt.config.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    removeResponseHeader(event, 'x-powered-by')
  })
})
