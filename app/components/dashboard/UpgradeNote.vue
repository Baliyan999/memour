<script setup lang="ts">
import { Sparkles } from '@lucide/vue'

/**
 * What a higher tier adds, where the couple meets a feature their tier
 * doesn't include (shared/plans.ts): a calm note with a way to reach
 * us, never a dead button or an error.
 */
defineProps<{ title: string; desc: string }>()

const EMAIL = 'hello@memour.uz'
</script>

<template>
  <div class="rounded-(--radius-xl) border border-(--color-primary)/20 bg-gradient-to-br from-(--color-accent)/30 to-(--color-rose)/15 p-5 sm:p-6">
    <div class="flex items-start gap-3">
      <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-(--color-primary)">
        <Sparkles class="h-5 w-5" :stroke-width="1.6" aria-hidden="true" />
      </div>
      <div class="min-w-0">
        <h2 class="font-display text-xl leading-snug">{{ title }}</h2>
        <p class="mt-1 text-sm text-(--color-muted-foreground)">{{ desc }}</p>
        <i18n-t keypath="couple.upgrade.contact" tag="p" scope="global" class="mt-3 text-sm">
          <template #email>
            <a :href="`mailto:${EMAIL}`" class="font-medium text-(--color-primary) underline-offset-4 hover:underline">{{ EMAIL }}</a>
          </template>
        </i18n-t>
      </div>
    </div>
  </div>
</template>
