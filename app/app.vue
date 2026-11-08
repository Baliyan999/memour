<script setup lang="ts">
import { MotionConfig } from 'motion-v'
import { useHead, useI18n, useLocaleHead, useRuntimeConfig } from '#imports'

/**
 * Root shell. Two app-wide concerns live here:
 *
 * - Locale head: <html lang>, hreflang alternates, canonical and
 *   og:url / og:locale for the current page, all from @nuxtjs/i18n
 *   (absolute thanks to runtimeConfig.public.i18n.baseUrl). og:image
 *   needs the absolute site URL too, so it's set here rather than in
 *   nuxt.config: the 1200×630 banner public/og-image.jpg (made by
 *   scripts/og-image.mjs — re-run it, don't edit the file). It carries
 *   no words to translate, so both languages share it; only its alt
 *   text follows the page's language.
 * - Motion: every motion-v animation honours the OS "Reduce motion"
 *   setting — transforms settle instantly, opacity still cross-fades,
 *   nothing stays hidden.
 * - iOS viewport: see below.
 */
const i18nHead = useLocaleHead({ seo: true })
const { t } = useI18n()
const siteUrl = String(useRuntimeConfig().public.siteUrl ?? '').replace(/\/+$/, '')
const ogImage = `${siteUrl}/og-image.jpg`

useHead(() => ({
  htmlAttrs: { lang: i18nHead.value.htmlAttrs?.lang },
  link: [...(i18nHead.value.link ?? [])],
  meta: [
    ...(i18nHead.value.meta ?? []),
    { property: 'og:image', content: ogImage },
    { property: 'og:image:type', content: 'image/jpeg' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: t('meta.ogImageAlt') },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:image', content: ogImage },
    { name: 'twitter:image:alt', content: t('meta.ogImageAlt') },
  ],
}))

// iOS Safari zooms into any focused field whose text is under 16px
// unless the viewport pins maximum-scale — and there the pin doesn't
// stop pinch-zoom (on Android it does, hence the plain viewport in
// nuxt.config). So pin it on iOS only; -webkit-touch-callout exists
// only in iOS WebKit.
if (import.meta.client && CSS.supports('-webkit-touch-callout', 'none')) {
  useHead({
    meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1' }],
  })
}
</script>

<template>
  <MotionConfig reduced-motion="user">
    <div>
      <NuxtRouteAnnouncer />
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
      <ToastStack />
      <ConfirmDialog />
    </div>
  </MotionConfig>
</template>
