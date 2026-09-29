<script setup lang="ts">
import { useI18n, useLocalePath } from '#imports'

/**
 * What happens to a guest's files, and the two boxes the server records
 * before the first upload (guest rules + licence, privacy policy; never
 * pre-ticked). Shown on the welcome screen and, if an upload is refused
 * for want of consent, in the sheet over the camera (pages/e/[id]).
 * The i18n keys are the ones shared/legal.ts consentTextKeys hashes
 * into the consent record — keep them in step.
 */
defineProps<{
  /** "27 марта 2027" — the event's deletion date, if known. */
  storedUntil: string | null
}>()
const rules = defineModel<boolean>('rules', { required: true })
const privacy = defineModel<boolean>('privacy', { required: true })

const { t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <div class="text-left">
    <p class="text-center text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">
      {{ t('guest.consent.title') }}
    </p>
    <ul class="mt-3 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-(--color-muted-foreground) marker:text-amber-600/70">
      <li>{{ t('guest.consent.who') }}</li>
      <li>{{ storedUntil ? t('guest.consent.storage', { date: storedUntil }) : t('guest.consent.storageGeneric') }}</li>
      <li>{{ t('guest.consent.people') }}</li>
      <li>{{ t('guest.consent.changedMind') }}</li>
    </ul>
    <div class="mt-4 flex flex-col gap-3">
      <LegalConsentCheckbox
        id="guest-rules"
        v-model="rules"
        keypath="guest.consent.rules"
        :link-text="t('guest.consent.rulesLink')"
        :to="`${localePath('/terms')}#guest-rules`"
      />
      <LegalConsentCheckbox
        id="guest-privacy"
        v-model="privacy"
        keypath="guest.consent.privacy"
        :link-text="t('guest.consent.privacyLink')"
        :to="localePath('/privacy')"
      />
    </div>
  </div>
</template>
