<script setup lang="ts">
import { useI18n, useLocalePath } from '#imports'
import { RefreshCw } from '@lucide/vue'
import type { Database } from '~/types/database.types'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: 'dashboard' })

/**
 * Dashboard home — couple's event list. Lists the events owned by
 * the logged-in user (RLS handles authorization). When the list is
 * empty we show a "no events yet" placeholder pointing the couple
 * back to the lead form if they haven't booked yet. A failed query
 * shows a retry instead — never "no events" to a couple who paid.
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const supabase = useSupabaseClient<Database>()

const { data: events, error, pending, refresh } = await useAsyncData('couple-events', async () => {
  const { data, error } = await supabase
    .from('events')
    .select('id, couple_names, wedding_date, venue_name, status')
    .order('wedding_date', { ascending: false })
  if (error) throw error
  return data ?? []
})

const fmtDate = (d: string) => formatDate(d, locale.value)
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <div class="mb-8 flex items-center justify-between gap-4">
      <h1 class="heading-display-md">{{ t('couple.dashboardTitle') }}</h1>
    </div>

    <div v-if="error" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl text-(--color-foreground)">{{ t('couple.loadErrorTitle') }}</h2>
      <p class="mt-3 text-(--color-muted-foreground)">{{ t('couple.loadErrorDesc') }}</p>
      <button
        type="button"
        :disabled="pending"
        class="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md border border-(--color-border) bg-white px-6 text-sm font-medium transition-transform duration-150 hover:bg-(--color-muted) active:scale-[0.97] disabled:opacity-60"
        @click="refresh()"
      >
        <RefreshCw class="h-4 w-4" :class="pending ? 'animate-spin' : ''" />
        {{ t('common.retry') }}
      </button>
    </div>

    <div v-else-if="!events || events.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl text-(--color-foreground)">{{ t('couple.noEventsTitle') }}</h2>
      <p class="mt-3 text-(--color-muted-foreground)">{{ t('couple.noEventsDesc') }}</p>
      <NuxtLink
        :to="localePath('/') + '#lead'"
        class="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90"
      >{{ t('couple.noEventsCta') }}</NuxtLink>
    </div>

    <ul v-else class="grid gap-4 sm:grid-cols-2">
      <li v-for="ev in events" :key="ev.id">
        <NuxtLink
          :to="localePath(`/dashboard/event/${ev.id}`)"
          class="surface-card block rounded-(--radius-xl) p-6 transition-transform duration-200 hover:-translate-y-1 active:translate-y-0 active:scale-[0.98] active:duration-100"
        >
          <span
            :class="[
              'inline-block rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-wider',
              ev.status === 'active'
                ? 'bg-green-500/15 text-green-700'
                : ev.status === 'draft'
                  ? 'bg-(--color-accent)/60 text-(--color-primary)'
                  : 'bg-(--color-muted) text-(--color-muted-foreground)',
            ]"
          >{{ t(`couple.statusBadge.${ev.status}`) }}</span>
          <h2 class="mt-3 font-display text-xl text-(--color-foreground)">{{ ev.couple_names }}</h2>
          <p class="mt-1 text-sm text-(--color-muted-foreground)">
            {{ fmtDate(ev.wedding_date) }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
          </p>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
