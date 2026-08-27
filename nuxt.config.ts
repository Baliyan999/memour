import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // App meta — title and description are overridden per-page via
  // useSeoMeta(); these are the global defaults.
  app: {
    head: {
      title: 'Memour',
      meta: [
        { charset: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
        },
        { name: 'theme-color', content: '#fbf6f0' },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'Memour' },
        // OG image — replace /memour-logo.png with a 1200x630 banner
        // before prod launch for better social previews.
        { property: 'og:image', content: '/memour-logo.png' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: '/memour-logo.png' },
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
    '@sentry/nuxt',
  ],

  // Supabase auth — protected routes are gated by our own global
  // middleware (`middleware/auth.global.ts`), so the module's built-in
  // redirect is off. Types pulled from the auto-generated file.
  //
  // cookieOptions.secure is derived from NUXT_PUBLIC_SITE_URL's protocol
  // because @nuxtjs/supabase defaults it to `true`, and Chrome silently
  // discards `Secure` cookies arriving over plain http:// (which is
  // what we serve from a bare IP before certbot is wired up). Flip it
  // back on automatically as soon as siteUrl becomes https://.
  supabase: {
    redirect: false,
    types: '~/types/database.types.ts',
    cookieOptions: {
      maxAge: 60 * 60 * 8,
      sameSite: 'lax',
      secure: (process.env.NUXT_PUBLIC_SITE_URL ?? '').startsWith('https://'),
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
    locales: [
      { code: 'uz', name: 'O\'zbekcha', file: 'uz.json' },
      { code: 'ru', name: 'Русский', file: 'ru.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'i18n_redirected',
      redirectOn: 'root',
    },
  },

  googleFonts: {
    families: {
      'Cormorant+Garamond': [400, 500, 600],
      'Manrope': [300, 400, 500, 600, 700],
    },
    display: 'swap',
    preconnect: true,
  },

  runtimeConfig: {
    // Server-only secrets
    supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    public: {
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    },
  },

  sentry: {
    sourceMapsUploadOptions: {
      org: 'memour',
      project: 'memour-nuxt',
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
  },

  typescript: {
    strict: true,
  },
})
