<script setup lang="ts">
import { useI18n } from '#imports'

const { t } = useI18n()

useSeoMeta({
  title: () => t('meta.title'),
  description: () => t('meta.description'),
  ogTitle: () => t('meta.title'),
  ogDescription: () => t('meta.description'),
})
</script>

<template>
  <div>
    <MarketingHeroSection />
    <MarketingStats />
    <MarketingStickyHeadline />
    <MarketingHow />
    <MarketingGalleryPreview />
    <MarketingFeatures />
    <MarketingPricing />
    <section id="lead" class="relative py-2 md:py-4 2xl:py-6 3xl:py-8 4xl:py-10">
      <!-- Same side gutter as every other section (was edge-to-edge on phones). -->
      <div class="container-page relative">
        <MarketingLeadForm />
      </div>
    </section>
  </div>
</template>
