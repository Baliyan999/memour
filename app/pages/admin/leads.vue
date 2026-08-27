<script setup lang="ts">
import { computed, ref } from 'vue'
import { useLocalePath } from '#imports'

definePageMeta({ layout: 'admin' })

/**
 * /admin/leads — incoming lead workflow.
 *
 * Filter chips by status, list with one-tap status transitions,
 * inline notes, and a "→ создать событие" shortcut that takes the
 * admin to the create-event form pre-filled with the lead's name +
 * phone + wedding_date + guests_estimate.
 */
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
  status: string
  notes: string | null
  converted_event_id: string | null
  created_at: string
}

const { data, refresh } = await useFetch<{ leads: Lead[] }>('/api/admin/leads')

const filtered = computed(() => {
  if (!data.value)
    return []
  if (statusFilter.value === 'all')
    return data.value.leads
  return data.value.leads.filter(l => l.status === statusFilter.value)
})

const counts = computed(() => {
  const c = { new: 0, contacted: 0, won: 0, lost: 0 }
  for (const l of data.value?.leads ?? []) {
    if (l.status in c)
      (c as any)[l.status]++
  }
  return c
})

async function setStatus(lead: Lead, status: 'new' | 'contacted' | 'won' | 'lost') {
  await $fetch(`/api/admin/leads/${lead.id}`, {
    method: 'PATCH',
    body: { status },
  })
  await refresh()
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function createEventFromLead(lead: Lead) {
  const params = new URLSearchParams()
  if (lead.name)
    params.set('couple_names', lead.name)
  if (lead.phone)
    params.set('owner_phone', lead.phone.replace(/\D/g, ''))
  if (lead.wedding_date)
    params.set('wedding_date', lead.wedding_date)
  if (lead.guests_estimate)
    params.set('table_count', String(Math.ceil(lead.guests_estimate / 10)))
  params.set('from_lead', lead.id)
  navigateTo(`${localePath('/admin/event/create')}?${params.toString()}`)
}

const statusLabel: Record<string, string> = {
  new: 'Новый',
  contacted: 'Связались',
  won: 'Конверсия',
  lost: 'Отказ',
}
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
      <h1 class="heading-display-md">
        Лиды
      </h1>
      <p class="text-sm text-(--color-muted-foreground)">
        Всего: {{ data?.leads.length ?? 0 }}
      </p>
    </div>

    <!-- Filter chips -->
    <div class="mb-6 flex flex-wrap items-center gap-2">
      <button
        v-for="s in ['all', 'new', 'contacted', 'won', 'lost'] as const"
        :key="s"
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors" :class="[
          statusFilter === s
            ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
            : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
        ]"
        @click="statusFilter = s"
      >
        <template v-if="s === 'all'">
          Все
        </template>
        <template v-else>
          {{ statusLabel[s] }}
        </template>
        <span v-if="s !== 'all'" class="text-[10px]">{{ counts[s] }}</span>
      </button>
    </div>

    <div
      v-if="filtered.length === 0"
      class="surface-card rounded-(--radius-xl) p-10 text-center"
    >
      <h2 class="text-xl">
        Лидов в этом фильтре нет
      </h2>
      <p class="mt-2 text-(--color-muted-foreground)">
        Лиды появляются автоматически когда пара заполняет форму на лендинге.
      </p>
    </div>

    <ul v-else class="grid gap-3">
      <li v-for="lead in filtered" :key="lead.id">
        <div class="surface-card flex flex-col gap-3 rounded-(--radius-xl) p-5 sm:grid sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-display text-lg">
                {{ lead.name }}
              </h2>
              <a
                :href="`tel:${lead.phone}`"
                class="text-sm text-(--color-primary) hover:underline"
              >{{ lead.phone }}</a>
              <span class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider" :class="[statusBadge[lead.status]]">
                {{ statusLabel[lead.status] }}
              </span>
            </div>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">
              {{ fmtDate(lead.created_at) }}
              <span v-if="lead.wedding_date"> · свадьба {{ lead.wedding_date }}</span>
              <span v-if="lead.guests_estimate"> · ~{{ lead.guests_estimate }} гостей</span>
              <span v-if="lead.source && lead.source !== 'landing'"> · {{ lead.source }}</span>
            </p>
            <p v-if="lead.converted_event_id" class="mt-1 text-xs text-emerald-700">
              ✓ привязано к событию
            </p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-if="lead.status === 'new'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-amber-100 px-3 text-xs text-amber-800 hover:bg-amber-200"
              @click="setStatus(lead, 'contacted')"
            >
              Связались
            </button>
            <button
              v-if="lead.status !== 'won' && lead.status !== 'lost'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-emerald-100 px-3 text-xs text-emerald-800 hover:bg-emerald-200"
              @click="createEventFromLead(lead)"
            >
              → Создать событие
            </button>
            <button
              v-if="lead.status !== 'lost' && lead.status !== 'won'"
              type="button"
              class="inline-flex h-8 items-center rounded-full bg-red-100 px-3 text-xs text-red-800 hover:bg-red-200"
              @click="setStatus(lead, 'lost')"
            >
              Отказ
            </button>
            <button
              v-if="lead.status === 'won' || lead.status === 'lost'"
              type="button"
              class="inline-flex h-8 items-center rounded-full border border-(--color-border) bg-white px-3 text-xs text-(--color-muted-foreground) hover:bg-(--color-muted)"
              @click="setStatus(lead, 'new')"
            >
              Вернуть
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
