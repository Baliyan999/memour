<script setup lang="ts">
import { ref } from 'vue'
import { useI18n, useLocalePath } from '#imports'
import { RefreshCw } from '@lucide/vue'
import { formatDate } from '~/utils/format'
import { GUEST_LIMIT_WARN_AT, guestLimitForTier } from '#shared/plans'

definePageMeta({ layout: 'admin' })

/**
 * Admin events list — pulls all events via /api/admin/events (which
 * uses service-role to bypass RLS). The page itself is gated by the
 * global auth middleware that checks the admins table. A failed load
 * says so (with a retry) instead of "no events yet". Each row shows its
 * guests against the tier's limit (shared/plans.ts), amber from 90 %.
 */
const { t, te, locale } = useI18n()
const localePath = useLocalePath()
const errorMessage = useErrorMessage()

const { data, error, refresh, pending } = await useFetch<{
  events: Array<{
    id: string
    couple_names: string
    wedding_date: string
    venue_name: string | null
    status: string
    plan_tier: string | null
    owner_id: string | null
    created_at: string
    table_count: number | null
    guests: number
  }>
}>('/api/admin/events')

// QR customizer modal state — clicking «QR PDF» on any event row
// opens the modal pre-populated with that event's id + couple names
// + table count (so the layout summary can say "10 tables → 2 pages").
// The modal stays mounted after the first open (qrOpen toggles it), so
// it can play its exit and hand focus back to the button.
const qrModalEvent = ref<{ id: string; couple_names: string; table_count: number | null } | null>(null)
const qrOpen = ref(false)
function openQr(ev: { id: string; couple_names: string; table_count?: number | null }) {
  qrModalEvent.value = {
    id: ev.id,
    couple_names: ev.couple_names,
    table_count: ev.table_count ?? null,
  }
  qrOpen.value = true
}

const fmtDate = (d: string) => formatDate(d, locale.value)

// Database values → the site's words; an unknown value shows nothing
// rather than itself.
const statusLabel = (s: string) => te(`couple.statusBadge.${s}`) ? t(`couple.statusBadge.${s}`) : ''
const tierLabel = (tier: string | null) => tier && te(`pricing.${tier}.name`) ? t(`pricing.${tier}.name`) : ''
const guestsNear = (ev: { guests: number; plan_tier: string | null }) =>
  ev.guests >= Math.ceil(guestLimitForTier(ev.plan_tier) * GUEST_LIMIT_WARN_AT)
</script>

<template>
  <div>
    <div class="mb-8 flex items-end justify-between gap-4">
      <h1 class="heading-display-md">{{ t('admin.events.title') }}</h1>
      <NuxtLink
        :to="localePath('/admin/event/create')"
        class="inline-flex h-10 items-center rounded-md bg-(--color-primary) px-5 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
      >{{ t('admin.events.create') }}</NuxtLink>
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

    <div v-else-if="error" class="surface-card rounded-(--radius-xl) p-10 text-center" role="alert">
      <p class="text-(--color-muted-foreground)">{{ errorMessage(error) }}</p>
      <button
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm transition-[transform,background-color] duration-150 hover:bg-(--color-muted) active:scale-[0.97]"
        @click="refresh()"
      >
        <RefreshCw class="h-4 w-4" />
        {{ t('common.retry') }}
      </button>
    </div>

    <div v-else-if="!data || data.events.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">{{ t('admin.events.emptyTitle') }}</h2>
      <p class="mt-2 text-(--color-muted-foreground)">{{ t('admin.events.emptyDesc') }}</p>
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
              <span v-if="tierLabel(ev.plan_tier)" class="rounded-full bg-(--color-muted) px-2 py-0.5 text-[10px] uppercase tracking-wider text-(--color-muted-foreground)">{{ tierLabel(ev.plan_tier) }}</span>
            </div>
            <p class="mt-1 text-sm text-(--color-muted-foreground)">
              {{ fmtDate(ev.wedding_date) }}<span v-if="ev.venue_name"> · {{ ev.venue_name }}</span>
            </p>
            <p
              class="mt-1 text-[11px] tabular-nums"
              :class="guestsNear(ev) ? 'text-amber-700' : 'text-(--color-muted-foreground)'"
            >
              {{ t('admin.events.guests', { n: ev.guests, max: guestLimitForTier(ev.plan_tier) }) }}
            </p>
            <p
              v-if="!ev.owner_id"
              class="mt-1 text-[11px] text-amber-700"
              :title="t('admin.events.notClaimedHint')"
            >
              {{ t('admin.events.notClaimed') }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-2">
            <code class="text-[10px] text-(--color-muted-foreground)">{{ ev.id.slice(0, 8) }}</code>
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1 rounded-full border border-(--color-border) bg-white px-3 text-[11px] text-(--color-foreground) hover:bg-(--color-muted)"
              :title="t('admin.events.qrHint')"
              @click="openQr(ev)"
            >
              <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              QR PDF
            </button>
            <NuxtLink
              :to="localePath(`/admin/event/${ev.id}`)"
              class="inline-flex h-7 items-center rounded-full border border-(--color-border) bg-white px-3 text-[11px] text-(--color-foreground) hover:bg-(--color-muted)"
            >{{ t('admin.events.edit') }}</NuxtLink>
          </div>
        </div>
      </li>
    </ul>

    <!-- QR customizer modal -->
    <AdminQrCustomizer
      v-if="qrModalEvent"
      :open="qrOpen"
      :event-id="qrModalEvent.id"
      :couple="qrModalEvent.couple_names"
      :table-count="qrModalEvent.table_count ?? undefined"
      @update:open="qrOpen = $event"
    />
  </div>
</template>
