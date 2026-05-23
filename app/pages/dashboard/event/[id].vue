<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n, useLocalePath } from '#imports'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'dashboard' })

/**
 * Couple event detail. RLS limits the SELECT to events owned by the
 * logged-in user, so a couple can never load somebody else's event.
 * Photos are paginated client-side as the count grows; for the first
 * pass we just fetch up to 200 and render a grid.
 */
const { t, locale } = useI18n()
const localePath = useLocalePath()
const route = useRoute()
const config = useRuntimeConfig()
const supabase = useSupabaseClient<Database>()

const id = route.params.id as string

const { data: ev, error: evErr } = await useAsyncData(`event-${id}`, async () => {
  const { data, error } = await supabase
    .from('events')
    .select('*, branding(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
})

if (evErr.value || !ev.value) {
  throw createError({ statusCode: 404, statusMessage: 'Событие не найдено' })
}

// Fetch ALL photos (visible + hidden) so the filter chips can switch
// between sets client-side without a network round-trip per change.
const { data: photos } = await useAsyncData(`photos-${id}`, async () => {
  const { data, error } = await supabase
    .from('photos')
    .select('id, storage_path, thumbnail_path, is_hidden, is_highlight, guest_table, guest_name, uploaded_at')
    .eq('event_id', id)
    .order('uploaded_at', { ascending: false })
    .limit(500)
  if (error) throw error
  return data ?? []
})

type FilterKey = 'visible' | 'highlights' | 'hidden' | 'by_table'
const filter = ref<FilterKey>('visible')
const tableFilter = ref<number | null>(null)

const visibleCount = computed(() => (photos.value ?? []).filter((p) => !p.is_hidden).length)
const highlightCount = computed(() => (photos.value ?? []).filter((p) => p.is_highlight && !p.is_hidden).length)
const hiddenCount = computed(() => (photos.value ?? []).filter((p) => p.is_hidden).length)

// Distinct tables present in the photo set — for the table filter.
const tables = computed(() => {
  const set = new Set<number>()
  for (const p of photos.value ?? []) {
    if (p.guest_table) set.add(p.guest_table)
  }
  return Array.from(set).sort((a, b) => a - b)
})

const filteredPhotos = computed(() => {
  const list = photos.value ?? []
  if (filter.value === 'visible') return list.filter((p) => !p.is_hidden)
  if (filter.value === 'highlights') return list.filter((p) => p.is_highlight && !p.is_hidden)
  if (filter.value === 'hidden') return list.filter((p) => p.is_hidden)
  if (filter.value === 'by_table' && tableFilter.value) {
    return list.filter((p) => p.guest_table === tableFilter.value)
  }
  return list
})

// Guest URL — printed on QR codes. Default locale (uz) is always
// embedded in the path so the QR resolves regardless of the visitor's
// browser language setting.
const guestUrl = computed(() => `${config.public.siteUrl}/uz/e/${id}`)

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString(locale.value === 'uz' ? 'uz-UZ' : 'ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

const { toast } = useToast()

const archivePending = ref(false)
async function archiveEvent() {
  if (!ev.value) return
  if (typeof window !== 'undefined' && !window.confirm('Архивировать событие? После архивации гости больше не смогут загружать фото.')) return
  archivePending.value = true
  try {
    await $fetch(`/api/couple/event/${ev.value.id}/status`, {
      method: 'PATCH',
      body: { status: 'archived' },
    })
    toast.success('Событие в архиве')
    window.location.reload()
  } catch (e: any) {
    toast.error('Не получилось архивировать')
  } finally {
    archivePending.value = false
  }
}

async function copyGuestUrl() {
  if (typeof navigator === 'undefined') return
  await navigator.clipboard.writeText(guestUrl.value)
  toast.success('Ссылка скопирована')
}

const payPending = ref(false)
const payError = ref<string | null>(null)

async function startCheckout(provider: 'payme' | 'click') {
  payPending.value = true
  payError.value = null
  try {
    const res = await $fetch<{ url: string; payment_id: string; dev?: boolean }>(
      `/api/checkout/${provider}`,
      { method: 'POST', body: { event_id: id } },
    )
    if (res.dev) {
      // Dev fallback: payment marked paid server-side immediately,
      // just reload to pick up the new active status.
      window.location.reload()
      return
    }
    if (typeof window !== 'undefined') window.location.href = res.url
  } catch (e: any) {
    const code = e?.data?.data?.code ?? e?.data?.code
    payError.value =
      code === 'already_paid' ? 'Уже оплачено' :
      code === 'forbidden' ? 'Нет доступа' :
      'Не удалось начать оплату'
  } finally {
    payPending.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <!-- Header -->
    <div class="mb-8">
      <NuxtLink
        :to="localePath('/dashboard')"
        class="mb-3 inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
      >
        <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Назад
      </NuxtLink>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="heading-display-md">{{ ev!.couple_names }}</h1>
          <p class="mt-1 text-(--color-muted-foreground)">
            {{ fmtDate(ev!.wedding_date) }}<span v-if="ev!.venue_name"> · {{ ev!.venue_name }}</span>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
            @click="copyGuestUrl"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Копировать ссылку
          </button>
          <NuxtLink
            :to="localePath(`/dashboard/event/${ev!.id}/moderate`)"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="14 2 18 6 7 17 3 17 3 13 14 2" />
              <line x1="3" y1="22" x2="21" y2="22" />
            </svg>
            Модерация
          </NuxtLink>
          <NuxtLink
            :to="localePath(`/dashboard/event/${ev!.id}/branding`)"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Оформление
          </NuxtLink>
          <a
            :href="`/uz/e/${ev!.id}/live`"
            target="_blank"
            rel="noopener"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Live слайдшоу
          </a>
          <button
            v-if="ev!.status === 'active'"
            type="button"
            :disabled="archivePending"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted) disabled:opacity-60"
            @click="archiveEvent"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            В архив
          </button>
          <a
            :href="`/api/couple/zip/${ev!.id}`"
            class="inline-flex h-10 items-center gap-2 rounded-full bg-(--color-primary) px-4 text-sm font-medium text-(--color-primary-foreground) hover:opacity-90"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Скачать архив
          </a>
        </div>
      </div>
    </div>

    <!-- Pay-to-activate banner: shown only for draft events -->
    <div
      v-if="ev!.status === 'draft'"
      class="mb-6 flex flex-col gap-4 rounded-(--radius-xl) border border-(--color-primary)/20 bg-gradient-to-br from-(--color-accent)/30 to-(--color-rose)/15 p-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p class="text-[10px] uppercase tracking-[0.3em] text-(--color-muted-foreground)">Активация</p>
        <h2 class="mt-1 font-display text-2xl italic">Оплатите чтобы открыть QR-коды для гостей</h2>
        <p class="mt-2 text-sm text-(--color-muted-foreground)">
          Тариф <strong class="font-medium text-(--color-foreground) capitalize">{{ ev!.plan_tier }}</strong>
          · после оплаты событие станет доступно для загрузки фото
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:items-end">
        <button
          type="button"
          :disabled="payPending"
          class="inline-flex h-11 items-center justify-center rounded-md bg-(--color-primary) px-6 text-sm font-medium text-(--color-primary-foreground) shadow-(--shadow-soft) hover:opacity-90 disabled:opacity-60"
          @click="startCheckout('payme')"
        >Оплатить через Payme</button>
        <button
          type="button"
          :disabled="payPending"
          class="inline-flex h-11 items-center justify-center rounded-md border border-(--color-border) bg-white px-6 text-sm font-medium hover:bg-(--color-muted) disabled:opacity-60"
          @click="startCheckout('click')"
        >Оплатить через Click</button>
        <p v-if="payError" class="text-xs text-red-600">{{ payError }}</p>
      </div>
    </div>

    <!-- Stats -->
    <div class="mb-8 grid grid-cols-3 gap-4">
      <div class="surface-card rounded-(--radius-xl) p-5">
        <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Фото</p>
        <p class="mt-1 font-display text-3xl">{{ photos?.length ?? 0 }}</p>
      </div>
      <div class="surface-card rounded-(--radius-xl) p-5">
        <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Столов</p>
        <p class="mt-1 font-display text-3xl">{{ ev!.table_count ?? 0 }}</p>
      </div>
      <div class="surface-card rounded-(--radius-xl) p-5">
        <p class="text-xs uppercase tracking-wider text-(--color-muted-foreground)">Статус</p>
        <p class="mt-1 font-display text-3xl capitalize">{{ ev!.status }}</p>
      </div>
    </div>

    <!-- Empty / photos grid -->
    <div v-if="!photos || photos.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">Пока ни одного фото</h2>
      <p class="mt-2 text-(--color-muted-foreground)">
        Гости начнут присылать снимки, как только отсканируют QR на свадьбе.
      </p>
      <p class="mt-4 break-all text-xs text-(--color-muted-foreground)">
        Ссылка для гостей: <code>{{ guestUrl }}</code>
      </p>
    </div>

    <template v-else>
      <!-- Filter chips -->
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
            filter === 'visible'
              ? 'border-(--color-primary) bg-(--color-primary) text-(--color-primary-foreground)'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="filter = 'visible'; tableFilter = null"
        >Все фото
          <span class="rounded-full bg-white/30 px-1.5 text-[10px]" v-if="filter === 'visible'">{{ visibleCount }}</span>
          <span class="text-[10px] text-(--color-muted-foreground)" v-else>{{ visibleCount }}</span>
        </button>
        <button
          type="button"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
            filter === 'highlights'
              ? 'border-amber-400 bg-amber-400 text-white'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="filter = 'highlights'; tableFilter = null"
        >
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          Избранное
          <span class="text-[10px]">{{ highlightCount }}</span>
        </button>
        <button
          v-if="hiddenCount > 0"
          type="button"
          :class="[
            'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
            filter === 'hidden'
              ? 'border-(--color-muted-foreground) bg-(--color-muted-foreground) text-white'
              : 'border-(--color-border) bg-white text-(--color-muted-foreground) hover:text-(--color-foreground)',
          ]"
          @click="filter = 'hidden'; tableFilter = null"
        >Скрытые <span class="text-[10px]">{{ hiddenCount }}</span></button>

        <div v-if="tables.length > 0" class="ml-2 flex items-center gap-1">
          <span class="text-xs text-(--color-muted-foreground)">стол:</span>
          <select
            v-model.number="tableFilter"
            :class="[
              'h-8 rounded-full border bg-white px-3 text-xs',
              filter === 'by_table' ? 'border-(--color-primary)' : 'border-(--color-border)',
            ]"
            @change="filter = tableFilter ? 'by_table' : 'visible'"
          >
            <option :value="null">все</option>
            <option v-for="t in tables" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
      </div>

      <div v-if="filteredPhotos.length === 0" class="surface-card rounded-(--radius-xl) p-10 text-center text-(--color-muted-foreground)">
        В этом фильтре фото нет.
      </div>

      <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <a
          v-for="p in filteredPhotos"
          :key="p.id"
          :href="`/api/photo/${p.id}`"
          target="_blank"
          rel="noopener"
          class="surface-card relative aspect-square overflow-hidden rounded-md"
          :class="p.is_hidden ? 'opacity-50' : ''"
        >
          <!-- Grid uses thumbnails for fast paint; click opens full-res. -->
          <img
            :src="`/api/photo/${p.id}?t=thumb`"
            alt=""
            class="h-full w-full object-cover"
            loading="lazy"
          >
          <span
            v-if="p.is_highlight"
            class="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-white shadow"
          >
            <svg viewBox="0 0 24 24" class="h-3 w-3" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
          </span>
          <span
            v-if="p.guest_table"
            class="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white"
          >стол {{ p.guest_table }}</span>
        </a>
      </div>
    </template>
  </div>
</template>
