<script setup lang="ts">
import { computed } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import type { LegalDocData } from '#shared/legal'

definePageMeta({ layout: 'default' })

/**
 * Public offer with the refund policy (section 16, #refund). It exists
 * only as a full document (shared/legal.ts); until it can be published
 * the payment and refund rules are the ones in the interim terms, so
 * /offer leads there.
 */
const { locale } = useI18n()
const localePath = useLocalePath()

const { data } = await useFetch('/api/legal/offer', { query: { locale } })
const full = computed(() => (data.value && data.value.mode !== 'interim' ? data.value as LegalDocData : null))
if (!full.value) await navigateTo(`${localePath('/terms')}#refund`, { redirectCode: 302, replace: true })

const title = () => (locale.value === 'uz' ? 'Ommaviy oferta · Memour' : 'Публичная оферта · Memour')
useSeoMeta({
  title,
  ogTitle: title,
  robots: () => (full.value?.mode === 'preview' ? 'noindex, nofollow' : undefined),
})
</script>

<template>
  <LegalDocument v-if="full" :doc="full" />
</template>
