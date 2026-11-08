/**
 * Shims for the Nitro auto-imports the code under test calls. Only the
 * contract the code relies on is reproduced, nothing more:
 *
 *   createError({ statusCode, statusMessage, data })  → an Error carrying them (h3)
 *   getRequestHeader(event, name)                     → event.node.req.headers[name] (h3)
 *   useRuntimeConfig()                                → a fixed test config
 */
class ShimH3Error extends Error {
  statusCode?: number
  statusMessage?: string
  data?: unknown
}

const g = globalThis as Record<string, unknown>

g.createError = (input: { statusCode?: number; statusMessage?: string; data?: unknown }) =>
  Object.assign(new ShimH3Error(input.statusMessage ?? ''), input)

g.getRequestHeader = (event: { node?: { req?: { headers?: Record<string, string | string[] | undefined> } } }, name: string) => {
  const v = event.node?.req?.headers?.[name.toLowerCase()]
  return Array.isArray(v) ? v.join(', ') : v
}

g.useRuntimeConfig = () => ({ public: { siteUrl: 'https://memour.test', legal: {} } })
