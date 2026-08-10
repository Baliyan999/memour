<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from '#imports'
import { useRoute } from 'vue-router'
import { motion, AnimatePresence } from 'motion-v'
import { Heart } from '@lucide/vue'

/**
 * LeadForm — RU/UZ-localized contact form. Sends a server call to
 * /api/lead which inserts into the leads table + pings Telegram.
 *
 * Referral tracking: if the visitor arrived via /?ref={code}, we
 * pass it along as `source: ref:{code}` so the admin attribution
 * report can match leads to partners.
 */
const { t, locale } = useI18n()
const route = useRoute()
const referralCode = computed(() => {
  const r = route.query.ref
  return typeof r === 'string' && /^[a-z0-9-]+$/i.test(r) ? r.toLowerCase() : null
})

const name = ref('')
const phone = ref('')
const phoneDigits = ref('')
const weddingDate = ref<string | null>(null)
const guests = ref<number | null>(null)

const pending = ref(false)
const success = ref(false)
const error = ref<string | null>(null)

async function onSubmit() {
  error.value = null
  pending.value = true
  try {
    const res = await $fetch<{ ok: boolean; error?: string }>('/api/lead', {
      method: 'POST',
      body: {
        name: name.value,
        phone: phone.value,
        wedding_date: weddingDate.value,
        guests_estimate: guests.value,
        source: referralCode.value ? `ref:${referralCode.value}` : 'landing',
        locale: locale.value,
      },
    })
    if (res.ok) {
      success.value = true
    } else {
      error.value = res.error ?? 'Error'
    }
  } catch (e: any) {
    error.value = e?.data?.error ?? e?.message ?? 'Network error'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <MarketingReveal class="mx-auto max-w-xl xl:max-w-2xl 2xl:max-w-3xl 3xl:max-w-4xl 4xl:max-w-5xl">
    <div class="surface-card relative rounded-(--radius-xl) p-6 sm:p-8 md:p-12 3xl:p-14 4xl:p-16">
      <!-- Decorative orbs in their own overflow-hidden layer so the
           calendar popup can escape -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-(--radius-xl)">
        <div aria-hidden="true" class="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-(--color-rose)/30 blur-3xl" />
        <div aria-hidden="true" class="absolute -left-12 -bottom-16 h-56 w-56 rounded-full bg-(--color-champagne)/40 blur-3xl" />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          v-if="success"
          key="success"
          :initial="{ opacity: 0, scale: 0.9 }"
          :animate="{ opacity: 1, scale: 1 }"
          :exit="{ opacity: 0 }"
          :transition="{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }"
          class="relative text-center"
        >
          <motion.div
            :initial="{ scale: 0 }"
            :animate="{ scale: 1 }"
            :transition="{ delay: 0.2, type: 'spring', stiffness: 220 }"
            class="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-(--color-primary) text-white animate-pulse-ring"
          >
            <Heart class="h-7 w-7" />
          </motion.div>
          <h3 class="text-3xl">{{ t('lead.successTitle') }}</h3>
          <p class="mt-3 text-(--color-muted-foreground)">{{ t('lead.successDesc') }}</p>
        </motion.div>

        <motion.form
          v-else
          key="form"
          :initial="{ opacity: 0 }"
          :animate="{ opacity: 1 }"
          :exit="{ opacity: 0 }"
          class="relative flex flex-col gap-5"
          @submit.prevent="onSubmit"
        >
          <div class="text-center">
            <h3 class="heading-display-md">{{ t('lead.title') }}</h3>
            <p class="mt-2 text-sm text-(--color-muted-foreground)">{{ t('lead.subtitle') }}</p>
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="name" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
              {{ t('lead.name') }}
            </label>
            <input
              id="name"
              v-model="name"
              required
              :minlength="2"
              :maxlength="50"
              class="flex h-11 w-full rounded-md border border-(--color-border) bg-white px-3 py-2 text-sm placeholder:text-(--color-muted-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-ring) 3xl:h-12 3xl:text-base 4xl:h-14 4xl:px-4 4xl:text-lg"
            >
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="phone" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
              {{ t('lead.phone') }}
            </label>
            <MarketingPhoneInput id="phone" v-model="phone" v-model:digits="phoneDigits" />
          </div>

          <!-- Grid cells equalize their heights automatically; using
               `flex flex-col` + `mt-auto` on the input wrapper pins both
               inputs to the bottom of the taller cell so they stay
               aligned even when one label wraps onto two lines
               (common on Uzbek "Taxminiy mehmonlar soni"). -->
          <div class="grid grid-cols-2 items-stretch gap-3">
            <div class="flex flex-col">
              <label for="wedding_date" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
                {{ t('lead.weddingDate') }}
              </label>
              <div class="mt-auto pt-1.5">
                <MarketingDatePicker id="wedding_date" v-model="weddingDate" />
              </div>
            </div>
            <div class="flex flex-col">
              <label for="guests" class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">
                {{ t('lead.guests') }}
              </label>
              <div class="mt-auto pt-1.5">
                <MarketingGuestStepper id="guests" v-model="guests" :min="10" :max="1000" />
              </div>
            </div>
          </div>

          <p v-if="error" class="text-sm text-red-600">{{ error }}</p>

          <button
            type="submit"
            :disabled="pending"
            class="inline-flex h-12 items-center justify-center rounded-md bg-(--color-primary) px-7 text-base font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) transition-colors hover:opacity-90 disabled:opacity-60"
          >
            {{ pending ? t('lead.submitting') : t('lead.submit') }}
          </button>
          <p class="text-center text-[11px] text-(--color-muted-foreground)">{{ t('lead.contactNote') }}</p>
        </motion.form>
      </AnimatePresence>
    </div>
  </MarketingReveal>
</template>
