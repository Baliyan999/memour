<script setup lang="ts">
import { useLocalePath } from '#imports'

definePageMeta({ layout: 'admin' })

/**
 * Admin events list — pulls all events via /api/admin/events (which
 * uses service-role to bypass RLS). The page itself is gated by the
 * global auth middleware that checks the admins table.
 */
const localePath = useLocalePath()

const { data, refresh, pending } = await useFetch<{
  events: Array<{
    id: string
    couple_names: string
    wedding_date: string
    venue_name: string | null
    status: string
    plan_tier: string | null
    owner_id: string | null
    created_at: string
  }>
}>('/api/admin/events')

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Активно',
  draft: 'Черновик',
  archived: 'Архив',
}
function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s
}
</script>

<template>
  <div>
    <div class="mb-8 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">События</h1>
      <NuxtLink
        :to="localePath('/admin/event/create')"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
      >+ Создать событие</NuxtLink>
    </div>

    <ul v-if="pending" class="grid gap-3" aria-busy="true">
      <li v-for="i in 4" :key="i">
        <div class="surface-card grid grid-cols-[1fr_auto] items-center gap-4 rounded-(--radius-xl) p-5">
          <div class="flex-1 space-y-2">
            <Skeleton class="h-5 w-48" />
            <Skeleton class="h-3 w-64" />
          </div>
          <Skeleton class="h-7 w-20" rounded="full" />
        </div>
      </li>
    </ul>

    <div v-else-if="!data || data.events.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">Событий ещё нет</h2>
      <p class="mt-2 text-(--color-muted-foreground)">Создайте первое — оно появится в кабинете пары.</p>
    </div>

    <ul v-else class="grid gap-3">
      <li v-for="ev in data.events" :key="ev.id">
        <div class="surface-card grid grid-cols-[1fr_auto] items-center gap-4 rounded-(--radius-xl) p-5">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="font-display text-lg">{{ ev.couple_names }}</h2>
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider',
                  ev.status === 'active'
                    ? 'bg-green-500/15 text-green-700'
                    : ev.status === 'draft'
                      ? 'bg-(--color-accent)/60 text-(--color-primary)'
                      : 'bg-(--color-muted) text-(--color-muted-foreground)',
                ]"
              >{{ statusLabel(ev.status) }}</span>
              <span class="rounded-full bg-(--color-muted) px-2 py-0.5 text-[10px] uppercase tracking-wider text-(--color-muted-foreground)">{{ ev.plan_tier }}</span>
            </div>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">
              {{ fmtDate(ev.wedding_date) }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
            </p>
            <p
              v-if="!ev.owner_id"
              class="mt-1 text-[11px] text-amber-700"
              title="Пара ещё не входила в кабинет. После первого SMS-входа аккаунт автоматически привяжется к этому событию."
            >
              ⚠ Пара ещё не вошла в кабинет
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <code class="text-[10px] text-(--color-muted-foreground)">{{ ev.id.slice(0, 8) }}</code>
            <a
              :href="`/api/admin/qr-pdf/${ev.id}`"
              target="_blank"
              rel="noopener"
              class="inline-flex h-7 items-center gap-1 rounded-full border border-(--color-border) bg-white px-3 text-[11px] text-(--color-foreground) hover:bg-(--color-muted)"
              title="Скачать PDF с QR-кодами"
            >
              <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              QR PDF
            </a>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
