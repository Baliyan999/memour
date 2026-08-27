<script setup lang="ts">
import { reactive, ref } from 'vue'

definePageMeta({ layout: 'admin' })

/**
 * /admin/referrals — manage partner referral codes. Each code is a
 * short slug (e.g. "sevara-fashion") that, when appended as ?ref=...
 * to the landing URL, gets attached to the resulting lead → event.
 *
 * The page shows the code list with attribution counts (leads /
 * events) and provides a compact inline form to add a new code.
 */
const { data, refresh } = await useFetch<{
  referrals: Array<{
    id: string
    code: string
    partner_name: string | null
    partner_phone: string | null
    commission_pct: number | null
    created_at: string
    lead_count: number
    event_count: number
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

async function submit() {
  pending.value = true
  error.value = null
  try {
    await $fetch('/api/admin/referrals', {
      method: 'POST',
      body: {
        code: form.code,
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
  }
  catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    error.value = code === 'duplicate_code'
      ? 'Такой код уже существует'
      : 'Не удалось создать код'
  }
  finally {
    pending.value = false
  }
}

const config = useRuntimeConfig()
function shareUrl(code: string) {
  return `${config.public.siteUrl}/?ref=${code}`
}
async function copyShare(code: string) {
  if (typeof navigator !== 'undefined') {
    await navigator.clipboard.writeText(shareUrl(code))
  }
}
</script>

<template>
  <div>
    <div class="mb-8 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">
        Рефералы
      </h1>
      <button
        type="button"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
        @click="showForm = !showForm"
      >
        {{ showForm ? 'Отмена' : '+ Добавить код' }}
      </button>
    </div>

    <!-- Inline create form -->
    <div
      v-if="showForm"
      class="mb-6 surface-card rounded-(--radius-xl) p-6"
    >
      <form class="grid grid-cols-2 gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Код (slug)</label>
          <input
            v-model="form.code"
            required
            placeholder="sevara-fashion"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm font-mono"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Имя партнёра</label>
          <input
            v-model="form.partner_name"
            placeholder="Севара (агентство)"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Телефон партнёра</label>
          <input
            v-model="form.partner_phone"
            placeholder="+998 90 123 45 67"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-[10px] uppercase tracking-[0.25em] text-(--color-muted-foreground)">Комиссия, %</label>
          <input
            v-model.number="form.commission_pct"
            type="number"
            min="0"
            max="100"
            class="h-11 rounded-md border border-(--color-border) bg-white px-3 text-sm"
          >
        </div>
        <p v-if="error" class="col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ error }}
        </p>
        <button
          type="submit"
          :disabled="pending"
          class="col-span-2 inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {{ pending ? 'Создаём…' : 'Создать' }}
        </button>
      </form>
    </div>

    <!-- List -->
    <div
      v-if="!data || data.referrals.length === 0"
      class="surface-card rounded-(--radius-xl) p-10 text-center"
    >
      <h2 class="text-xl">
        Реферальных кодов нет
      </h2>
      <p class="mt-2 text-(--color-muted-foreground)">
        Создайте первый — раздавайте партнёрам ссылку с ?ref={code}
      </p>
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
              <span>{{ r.lead_count }} заявок</span>
              · <span>{{ r.event_count }} событий</span>
              <span v-if="r.partner_phone"> · {{ r.partner_phone }}</span>
            </p>
          </div>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-full border border-(--color-border) bg-white px-3 text-xs hover:bg-(--color-muted)"
            @click="copyShare(r.code)"
          >
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Копировать ссылку
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
