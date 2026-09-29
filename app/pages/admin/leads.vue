<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { RefreshCw } from '@lucide/vue'
import { formatDate, formatPhone } from '~/utils/format'

definePageMeta({ layout: 'admin' })

/**
 * /admin/leads — incoming lead workflow.
 *
 * Filter chips by status, list with one-tap status transitions,
 * inline notes, and a "→ создать событие" shortcut that takes the
 * admin to the create-event form pre-filled with the lead's name +
 * phone + wedding_date + guests_estimate + the tier picked on the
 * site's Pricing card (shown on the lead as "Тариф: Premium").
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const statusFilter = ref<'all' | 'new' | 'contacted' | 'won' | 'lost'>('all')

interface Lead {
  id: string
  name: string
  phone: string
  wedding_date: string | null
  guests_estimate: number | null
  source: string | null
  locale: string | null
  plan_tier: string | null
  status: string
  notes: string | null
  converted_event_id: string | null
  created_at: string
}

const { toast } = useToast()
const errorMessage = useErrorMessage()

// Filtering and the chip counts happen on the server: the list is
// capped at the newest `limit` rows, the counts cover every lead.
const { data, error: loadError, refresh } = await useFetch<{
  leads: Lead[]
  counts: Record<'new' | 'contacted' | 'won' | 'lost', number>
  total: number
  limit: number
}>('/api/admin/leads', {
  query: computed(() => (statusFilter.value === 'all' ? {} : { status: statusFilter.value })),
})

const filtered = computed(() => data.value?.leads ?? [])
const counts = computed(() => data.value?.counts ?? { new: 0, contacted: 0, won: 0, lost: 0 })

async function setStatus(lead: Lead, status: 'new' | 'contacted' | 'won' | 'lost') {
  try {
    await $fetch(`/api/admin/leads/${lead.id}`, {
      method: 'PATCH',
      body: { status },
    })
    await refresh()
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

/** "28 сентября 2026, 14:05" / "28-sentabr, 2026, 14:05" in Tashkent time. */
function fmtDateTime(d: string) {
  const time = new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })
  const day = new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })
  return `${formatDate(day, locale.value)}, ${time}`
}
const fmtDate = (d: string) => formatDate(d, locale.value)

function createEventFromLead(lead: Lead) {
  const params = new URLSearchParams()
  if (lead.name) params.set('couple_names', lead.name)
  // Leads keep the number as +998XXXXXXXXX (older ones as typed); the
  // create form wants the 9 digits after +998.
  if (lead.phone) params.set('owner_phone', lead.phone.replace(/\D/g, '').replace(/^998(?=\d{9}$)/, ''))
  if (lead.wedding_date) params.set('wedding_date', lead.wedding_date)
  if (lead.guests_estimate) params.set('table_count', String(Math.ceil(lead.guests_estimate / 10)))
  if (lead.plan_tier) params.set('plan_tier', lead.plan_tier)
  params.set('from_lead', lead.id)
  navigateTo(`${localePath('/admin/event/create')}?${params.toString()}`)
}

const statusLabel = (s: string) => (['new', 'contacted', 'won', 'lost'].includes(s) ? t(`admin.leads.status.${s}`) : '')
const statusBadge: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  won: 'bg-emerald-100 text-emerald-700',
  lost: 'bg-red-100 text-red-700',
}
</script>

<template>
  <div>
    <div class="mb-8 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">{{ t('admin.leads.title') }}</h1>
      <p class="text-sm text-(--color-muted-foreground)">
        {{ t('admin.leads.total', { n: data?.total ?? 0 }) }}
      </p>
    </div>

    <!-- Filter chips -->
    <div class="mb-6 flex flex-wrap items-center gap-2">
      <button
        v-for="s in ['all','new','contacted','won','lost'] as const"
        :key="s"
        type="button"
        :class="[
          'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
          statusFilter === s
            ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
            : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
        ]"
        @click="statusFilter = s"
      >
        <template v-if="s === 'all'">{{ t('admin.leads.all') }}</template>
        <template v-else>{{ statusLabel(s) }}</template>
        <span v-if="s !== 'all'" class="text-[10px]">{{ counts[s] }}</span>
      </button>
    </div>

    <!-- A failed load says so — never "no leads" -->
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
      v-else-if="filtered.length === 0"
      class="surface-card rounded-(--radius-xl) p-10 text-center"
    >
      <h2 class="text-xl">{{ t('admin.leads.emptyTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ t('admin.leads.emptyDesc') }}</p>
    </div>

    <ul v-else class="grid gap-3">
      <li v-if="data && filtered.length >= data.limit" class="text-xs text-(--color-muted-foreground)">
        {{ t('admin.leads.shownLast', { n: data.limit }) }}
      </li>
      <li v-for="lead in filtered" :key="lead.id">
        <div class="surface-card flex flex-col gap-3 rounded-(--radius-xl) p-5 sm:grid sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-display text-lg">{{ lead.name }}</h2>
              <a
                :href="`tel:${lead.phone}`"
                class="text-sm text-(--color-primary) hover:underline"
              >{{ formatPhone(lead.phone) }}</a>
              <span :class="['rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider', statusBadge[lead.status]]">
                {{ statusLabel(lead.status) }}
              </span>
              <span v-if="lead.plan_tier" class="rounded-full bg-(--color-accent)/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-(--color-primary)">
                {{ t('lead.chosenTier', { tier: t(`pricing.${lead.plan_tier}.name`) }) }}
              </span>
            </div>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">
              {{ fmtDateTime(lead.created_at) }}
              <span v-if="lead.wedding_date"> · {{ t('admin.leads.wedding', { date: fmtDate(lead.wedding_date) }) }}</span>
              <span v-if="lead.guests_estimate"> · {{ t('admin.leads.guests', { n: lead.guests_estimate }) }}</span>
              <span v-if="lead.source && lead.source !== 'landing'"> · {{ lead.source }}</span>
            </p>
            <p v-if="lead.converted_event_id" class="mt-1 text-xs text-emerald-700">
              {{ t('admin.leads.linked') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-if="lead.status === 'new'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-amber-100 px-3 text-xs text-amber-800 hover:bg-amber-200"
              @click="setStatus(lead, 'contacted')"
            >{{ t('admin.leads.markContacted') }}</button>
            <button
              v-if="lead.status !== 'won' && lead.status !== 'lost'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-emerald-100 px-3 text-xs text-emerald-800 hover:bg-emerald-200"
              @click="createEventFromLead(lead)"
            >{{ t('admin.leads.createEvent') }}</button>
            <button
              v-if="lead.status !== 'lost' && lead.status !== 'won'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-red-100 px-3 text-xs text-red-800 hover:bg-red-200"
              @click="setStatus(lead, 'lost')"
            >{{ t('admin.leads.markLost') }}</button>
            <button
              v-if="lead.status === 'won' || lead.status === 'lost'"
              type="button"
              class="inline-flex h-8 items-center rounded-full border border-(--color-border) bg-white px-3 text-xs text-(--color-muted-foreground) hover:bg-(--color-muted)"
              @click="setStatus(lead, 'new')"
            >{{ t('admin.leads.reopen') }}</button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
