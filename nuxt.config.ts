import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

// Supabase origin(s) for the CSP below. Hosted projects all live on
// *.supabase.co; the build-time URL is added too so a self-hosted or
// local stack (http://127.0.0.1:54321) is covered.
const supabaseOrigins = (() => {
  const list = ['https://*.supabase.co', 'wss://*.supabase.co']
  try {
    const u = new URL(process.env.NUXT_PUBLIC_SUPABASE_URL ?? '')
    if (!u.hostname.endsWith('.supabase.co')) {
      list.push(u.origin, `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`)
    }
  } catch { /* no URL at build time — the wildcard covers hosted projects */ }
  return list.join(' ')
})()

// Report-Only for now: it describes what the real app loads (Supabase
// REST/Storage/Realtime, Google Fonts, camera blob: previews, the
// image-compression worker from jsDelivr) and reports anything else to
// /csp-report without blocking it. Flip to enforcing once the reports
// stay quiet in production.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabaseOrigins}`,
  `media-src 'self' blob: ${supabaseOrigins}`,
  `connect-src 'self' ${supabaseOrigins} https://cdn.jsdelivr.net`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'report-uri /csp-report',
].join('; ')

// Private pages (guest capture/live, couple dashboard, admin) must
// never show up in search results, whatever robots.txt says.
const noindex = { headers: { 'X-Robots-Tag': 'noindex, nofollow' } }

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // DevTools only ever run under `nuxt dev`; keep them off everywhere
  // else so a build machine never exposes the RPC.
  devtools: { enabled: false },
  $development: {
    devtools: { enabled: true },
  },

  // App meta — title and description are overridden per-page via
  // useSeoMeta(); these are the global defaults.
  app: {
    head: {
      title: 'Memour',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          // No maximum-scale / user-scalable: people must be able to
          // pinch-zoom (WCAG 1.4.4). iOS, which keeps pinch-zoom anyway,
          // gets maximum-scale=1 from app.vue so it doesn't zoom into
          // small form fields on focus.
          content: 'width=device-width, initial-scale=1',
        },
        { name: 'theme-color', content: '#fbf6f0' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Memour' },
        // og:image / twitter:image are set in app.vue — they need the
        // absolute site URL, which is only known at runtime.
      ],
      link: [
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },

  // Global CSS — Tailwind v4 entrypoint + design tokens + brand styles
  css: ['~/assets/css/main.css'],

  modules: [
    '@nuxtjs/i18n',
    '@nuxtjs/google-fonts',
    '@nuxtjs/supabase',
    '@vueuse/nuxt',
  ],

  // Supabase auth — protected routes are gated by our own global
  // middleware (`middleware/auth.global.ts`), so the module's built-in
  // redirect is off. Types pulled from the auto-generated file.
  //
  // cookieOptions.secure is only turned off for an explicit http://
  // siteUrl at build time (local dev, a bare IP before certbot):
  // Chrome silently discards `Secure` cookies over plain http. A build
  // without the variable gets Secure cookies. It's baked into the
  // bundle, so a server that moves between http and https without a
  // rebuild overrides it at runtime with
  // NUXT_PUBLIC_SUPABASE_COOKIE_OPTIONS_SECURE — env-check warns when
  // it disagrees with siteUrl.
  //
  // The service-role key is resolved at RUNTIME and never written into
  // .output: NUXT_SUPABASE_SECRET_KEY (the module's own name) wins, and
  // the legacy SUPABASE_SERVICE_ROLE_KEY still works through Nitro's
  // env expansion (see nitro.experimental.envExpansion below).
  supabase: {
    redirect: false,
    types: '~/types/database.types.ts',
    secretKey: '{{SUPABASE_SERVICE_ROLE_KEY}}',
    cookieOptions: {
      maxAge: 60 * 60 * 8,
      sameSite: 'lax',
      secure: !(process.env.NUXT_PUBLIC_SITE_URL ?? '').startsWith('http://'),
    },
  },

  // Tailwind v4 via official Vite plugin (Nuxt 4 supports Vite plugins
  // declaratively via the `vite` config block).
  vite: {
    plugins: [tailwindcss()],
  },

  // Locale routing — mirrors the existing Next.js [locale] segment with
  // `/ru` and `/uz` prefixes. Default locale (ru) keeps a `/ru` prefix
  // so URLs are explicit, matching the existing site behavior.
  i18n: {
    strategy: 'prefix',
    defaultLocale: 'uz',
    // `language` drives <html lang>, hreflang and og:locale (see
    // useLocaleHead in app.vue); baseUrl comes from runtimeConfig.
    locales: [
      { code: 'uz', language: 'uz-UZ', name: "O'zbekcha", file: 'uz.json' },
      { code: 'ru', language: 'ru-RU', name: 'Русский', file: 'ru.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },

  googleFonts: {
    families: {
      // Italic cuts too: accent words and headings are set in italic,
      // and a synthesized slant looks broken in Cyrillic.
      'Cormorant+Garamond': { wght: [400, 500, 600], ital: [400, 500] },
      'Manrope': [300, 400, 500, 600, 700],
    },
    display: 'swap',
    preconnect: true,
  },

  runtimeConfig: {
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
      // Absolute URLs for canonical / hreflang. Expanded from the same
      // NUXT_PUBLIC_SITE_URL at runtime, so the two can't drift apart.
      i18n: {
        baseUrl: '{{NUXT_PUBLIC_SITE_URL}}',
      },
      // The operator's details for the full legal documents (shared/legal.ts):
      // NUXT_PUBLIC_LEGAL_ENTITY_NAME, …_INN, …_REGISTRATION, …_ADDRESS,
      // …_POSTAL_ADDRESS, …_PHONE, …_EMAIL, …_BANK (…_RU variants for the
      // Russian text) and NUXT_PUBLIC_LEGAL_EFFECTIVE_DATE (YYYY-MM-DD).
      // Until the required ones are set, /privacy and /terms stay the short
      // interim pages. NUXT_PUBLIC_LEGAL_PREVIEW=true shows the drafts,
      // marked as such, for review — never on the production server.
      legal: {
        entityName: '',
        entityNameRu: '',
        entityInn: '',
        entityRegistration: '',
        entityRegistrationRu: '',
        entityAddress: '',
        entityAddressRu: '',
        entityPostalAddress: '',
        entityPostalAddressRu: '',
        entityPhone: '',
        entityEmail: '',
        entityBank: '',
        entityBankRu: '',
        effectiveDate: '',
        preview: false,
      },
    },
  },

  nitro: {
    // Lets runtimeConfig values reference env vars as {{NAME}} and have
    // them filled in when the server starts rather than at build time.
    experimental: {
      envExpansion: true,
      tasks: true,
    },
    // Retention purge (server/tasks/cleanup-archives.ts): daily at 03:00
    // server time. Dry run until RETENTION_PURGE_ENABLED=true.
    scheduledTasks: { '0 3 * * *': ['cleanup-archives'] },
    // Pre-compressed .gz/.br copies of /_nuxt assets; HTML and API
    // responses are compressed by nginx (docs/DEPLOY.md).
    compressPublicAssets: { gzip: true, brotli: true },
  },

  routeRules: {
    '/**': {
      headers: {
        'Strict-Transport-Security': 'max-age=31536000',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        // Guests shoot photos, record video/voice and share location on
        // /e/*; nothing else (and no third-party frame) gets these.
        'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()',
        // frame-ancestors is ignored in Report-Only, so it is enforced on
        // its own; everything else is report-only for now.
        'Content-Security-Policy': "frame-ancestors 'none'",
        'Content-Security-Policy-Report-Only': cspReportOnly,
      },
    },
    // Short addresses the legal texts and QR cards print (memour.uz/terms)
    // → the page in the default language, which has a language switch.
    '/privacy': { redirect: '/uz/privacy' },
    '/terms': { redirect: '/uz/terms' },
    '/offer': { redirect: '/uz/offer' },
    '/refund': { redirect: '/uz/refund' },
    '/uz/e/**': noindex,
    '/ru/e/**': noindex,
    '/uz/dashboard/**': noindex,
    '/ru/dashboard/**': noindex,
    '/uz/admin/**': noindex,
    '/ru/admin/**': noindex,
  },

  typescript: {
    strict: true,
  },

  // Route transitions: the View Transitions API with the rules in
  // main.css (old page fades out, new one settles in on the default
  // spring; header/backdrop stay put). Nuxt skips them under Reduce
  // Motion and in browsers without the API.
  experimental: { viewTransition: true },

  hooks: {
    // server/error.ts handles /api/** errors first (stable codes, a
    // localized page for a tab that opened an /api link); pages still
    // fall through to Nuxt's handler and app/error.vue. Setting
    // nitro.errorHandler directly would replace Nuxt's handler.
    'nitro:config'(nitroConfig) {
      const apiErrors = fileURLToPath(new URL('./server/error.ts', import.meta.url))
      nitroConfig.errorHandler = [apiErrors, ...[nitroConfig.errorHandler ?? []].flat()]
    },
  },
})
