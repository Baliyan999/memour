<script setup lang="ts">
import { ref, reactive, nextTick } from 'vue'
import { RefreshCw } from '@lucide/vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/referrals — manage partner referral codes. Each code is a
 * short slug (e.g. "sevara-fashion") that, when appended as ?ref=...
 * to the landing URL, gets attached to the resulting lead → event.
 *
 * The page shows the code list with attribution counts (unique
 * leads / events created from them / of those, paid) and provides a
 * compact inline form to add a new code.
 *
 * The form checks the code itself (novalidate: the browser's bubbles
 * speak the browser's language); the server's field codes
 * (invalid_referral_code, invalid_commission, duplicate_code) show
 * above the button.
 */
const { data, error: loadError, refresh } = await useFetch<{
  referrals: Array<{
    id: string
    code: string
    partner_name: string | null
    partner_phone: string | null
    commission_pct: number | null
    created_at: string
    lead_count: number
    event_count: number
    paid_event_count: number
  }>
}>('/api/admin/referrals')

const showForm = ref(false)
const form = reactive({
  code: '',
  partner_name: '',
  partner_phone: '',
  commission_pct: 10,
})
const pending = ref(false)
const error = ref<string | null>(null)
const { toast } = useToast()
const errorMessage = useErrorMessage()
const { t } = useI18n()

const CODE_RE = /^[A-Za-z0-9-]{2,32}$/

async function submit() {
  if (pending.value) return
  if (!CODE_RE.test(form.code.trim())) {
    error.value = errorMessage('invalid_referral_code')
    return
  }
  const pct = form.commission_pct as number | string | null
  if (pct === '' || pct === null || !Number.isFinite(Number(pct)) || Number(pct) < 0 || Number(pct) > 100) {
    error.value = errorMessage('invalid_commission')
    return
  }
  pending.value = true
  error.value = null
  try {
    await $fetch('/api/admin/referrals', {
      method: 'POST',
      body: {
        code: form.code.trim(),
        partner_name: form.partner_name || null,
        partner_phone: form.partner_phone || null,
        commission_pct: form.commission_pct,
      },
    })
    form.code = ''
    form.partner_name = ''
    form.partner_phone = ''
    showForm.value = false
    await refresh()
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    pending.value = false
  }
}

const config = useRuntimeConfig()
function shareUrl(code: string) {
  return `${config.public.siteUrl.replace(/\/+$/, '')}/?ref=${code}`
}
// The code whose link a refused copy left on screen, selected, so the
// toast's "select the link and copy it" has something to select (plain
// http has no Clipboard API; a browser may also deny the permission).
const manualCopy = ref<string | null>(null)
async function copyShare(code: string) {
  manualCopy.value = null
  try {
    await navigator.clipboard.writeText(shareUrl(code))
    toast.success(t('admin.referrals.copied'))
  } catch {
    manualCopy.value = code
    toast.error(t('errors.copy_failed'))
    await nextTick()
    const field = document.getElementById(`ref-link-${code}`) as HTMLInputElement | null
    field?.focus()
    field?.select()
  }
}
</script>

<template>
  <div>
    <div class="mb-8 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">{{ t('admin.referrals.title') }}</h1>
      <button
        type="button"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? t('common.cancel') : t('admin.referrals.add') }}
      </button>
    </div>

    <!-- Inline create form -->
    <div
      v-if="showForm"
      class="mb-6 surface-card rounded-(--radius-xl) p-6"
    >
      <form class="grid grid-cols-2 gap-4" novalidate @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <label for="ref-code" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.referrals.code') }}</label>
          <input
            id="ref-code"
            v-model="form.code"
            maxlength="32"
            autocapitalize="off"
            placeholder="sevara-fashion"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm font-mono"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ref-name" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.referrals.partnerName') }}</label>
          <input
            id="ref-name"
            v-model="form.partner_name"
            :placeholder="t('admin.referrals.partnerNamePlaceholder')"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ref-phone" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.referrals.partnerPhone') }}</label>
          <input
            id="ref-phone"
            v-model="form.partner_phone"
            placeholder="+998 90 123 45 67"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="ref-pct" class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">{{ t('admin.referrals.commission') }}</label>
          <input
            id="ref-pct"
            v-model.number="form.commission_pct"
            type="number"
            inputmode="decimal"
            min="0"
            max="100"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <p v-if="error" role="alert" class="col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
        <button
          type="submit"
          :disabled="pending"
          class="col-span-2 inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >{{ pending ? t('admin.referrals.creating') : t('admin.referrals.create') }}</button>
      </form>
    </div>

    <!-- List (a failed load says so — never "no codes") -->
    <div v-if="loadError" class="surface-card rounded-(--radius-xl) p-10 text-center" role="alert">
      <p class="text-(--color-muted-foreground)">{{ errorMessage(loadError) }}</p>
      <button
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97]"
        @click="refresh()"
      >
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <div
      v-else-if="!data || data.referrals.length === 0"
      class="surface-card rounded-(--radius-xl) p-10 text-center"
    >
      <h2 class="text-xl">{{ t('admin.referrals.emptyTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ t('admin.referrals.emptyDesc') }}</p>
    </div>

    <ul v-else class="grid gap-3">
      <li v-for="r in data.referrals" :key="r.id">
        <div class="surface-card grid grid-cols-[1fr_auto] items-center gap-4 rounded-(--radius-xl) p-5">
          <div>
            <div class="flex flex-wrap items-center gap-3">
              <code class="rounded-md bg-(--color-muted) px-2 py-0.5 text-xs">{{ r.code }}</code>
              <span v-if="r.partner_name" class="font-display text-lg">{{ r.partner_name }}</span>
              <span v-if="r.commission_pct != null" class="rounded-full bg-(--color-accent)/60 px-2 py-0.5 text-[11px] text-(--color-primary)">
                {{ r.commission_pct }}%
              </span>
            </div>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">
              <span>{{ t('admin.referrals.leads', { n: r.lead_count }) }}</span>
              · <span>{{ t('admin.referrals.events', { n: r.event_count }) }}</span>
              · <span>{{ t('admin.referrals.paid', { n: r.paid_event_count }) }}</span>
              <span v-if="r.partner_phone"> · {{ r.partner_phone }}</span>
            </p>
            <input
              v-if="manualCopy === r.code"
              :id="`ref-link-${r.code}`"
              :value="shareUrl(r.code)"
              :aria-label="t('admin.referrals.linkLabel')"
              readonly
              class="mt-2 h-9 w-full rounded-md border border-(--color-border) bg-white px-3 text-xs"
              @focus="($event.target as HTMLInputElement).select()"
            >
          </div>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-full border border-(--color-border) bg-white px-3 text-xs hover:bg-(--color-muted)"
            @click="copyShare(r.code)"
          >
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {{ t('admin.referrals.copyLink') }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
