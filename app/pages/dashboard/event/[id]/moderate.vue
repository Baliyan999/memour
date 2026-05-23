<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useLocalePath } from '#imports'
import { motion, useMotionValue, useTransform } from 'motion-v'
import { X, Heart, Star, Undo2 } from '@lucide/vue'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'dashboard' })

/**
 * /dashboard/event/[id]/moderate — Tinder-style swipe moderation.
 *
 * The couple sees one photo at a time as a polaroid card. Drag the
 * card left to HIDE (is_hidden=true), right to KEEP, or tap the heart
 * button to mark as HIGHLIGHT (is_highlight=true).
 *
 * Implementation notes:
 *   - We render the current + next card together so the next photo
 *     peeks underneath, giving the stack a tactile feel.
 *   - motion-v's useMotionValue drives the card's `x` translation
 *     during drag; on drag end if |x| > threshold we commit the
 *     decision and pop the card off the stack.
 *   - Undo lets the couple revert the last decision (one level deep).
 */
const route = useRoute()
const localePath = useLocalePath()
const id = route.params.id as string
const supabase = useSupabaseClient<Database>()

interface PhotoCard {
  id: string
  storage_path: string
  is_hidden: boolean
  is_highlight: boolean
  guest_name: string | null
  guest_table: number | null
}

const { data: pageData } = await useAsyncData(`moderate-${id}`, async () => {
  const { data: ev } = await supabase
    .from('events')
    .select('id, couple_names')
    .eq('id', id)
    .single()
  const { data: photos } = await supabase
    .from('photos')
    .select('id, storage_path, is_hidden, is_highlight, guest_name, guest_table')
    .eq('event_id', id)
    .order('uploaded_at', { ascending: false })
  return { ev, photos: (photos ?? []) as PhotoCard[] }
})

const queue = ref<PhotoCard[]>(pageData.value?.photos ?? [])
const lastAction = ref<{ photo: PhotoCard; decision: 'kept' | 'hidden' | 'highlighted' } | null>(null)
const processed = ref(0)

const current = computed(() => queue.value[0] ?? null)
const next = computed(() => queue.value[1] ?? null)
const total = computed(() => (pageData.value?.photos.length ?? 0))
const progress = computed(() => total.value === 0 ? 0 : Math.round((processed.value / total.value) * 100))

const photoUrl = (id: string) => `/api/photo/${id}`

// Drag motion values. useMotionValue gives us a reactive number we
// can bind to motion.div's :style.x — and we read it on drag end.
const x = useMotionValue(0)
const rotate = useTransform(x, [-260, 0, 260], [-12, 0, 12])
const opacity = useTransform(x, [-260, -120, 0, 120, 260], [0.5, 1, 1, 1, 0.5])
const hideTagOpacity = useTransform(x, [-160, -40, 0], [1, 0.2, 0])
const keepTagOpacity = useTransform(x, [0, 40, 160], [0, 0.2, 1])

const decisionInFlight = ref(false)

async function commit(decision: 'kept' | 'hidden' | 'highlighted') {
  if (decisionInFlight.value || !current.value) return
  decisionInFlight.value = true
  const card = current.value
  try {
    if (decision !== 'kept') {
      await $fetch(`/api/couple/photo/${card.id}`, {
        method: 'PATCH',
        body: decision === 'hidden'
          ? { is_hidden: true }
          : { is_highlight: !card.is_highlight },
      })
    }
    lastAction.value = { photo: { ...card }, decision }
    queue.value = queue.value.slice(1)
    processed.value += 1
    // Reset drag offset for the new top card.
    x.set(0)
  } finally {
    decisionInFlight.value = false
  }
}

function onDragEnd(_: unknown, info: { offset: { x: number } }) {
  if (info.offset.x < -140) commit('hidden')
  else if (info.offset.x > 140) commit('kept')
  else x.set(0) // snap back
}

async function undo() {
  if (!lastAction.value) return
  const { photo, decision } = lastAction.value
  // Revert server-side
  if (decision === 'hidden') {
    await $fetch(`/api/couple/photo/${photo.id}`, { method: 'PATCH', body: { is_hidden: false } })
  } else if (decision === 'highlighted') {
    await $fetch(`/api/couple/photo/${photo.id}`, { method: 'PATCH', body: { is_highlight: photo.is_highlight } })
  }
  queue.value = [photo, ...queue.value]
  processed.value = Math.max(0, processed.value - 1)
  lastAction.value = null
  x.set(0)
}

// Keyboard shortcuts: ←/→/space for power-users on laptop.
onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.key === 'ArrowLeft') commit('hidden')
    else if (e.key === 'ArrowRight') commit('kept')
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      commit('highlighted')
    } else if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      undo()
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
})
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <NuxtLink
      :to="localePath(`/dashboard/event/${id}`)"
      class="mb-3 inline-flex items-center gap-1.5 text-sm text-(--color-muted-foreground) hover:text-(--color-foreground)"
    >
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      Назад к событию
    </NuxtLink>

    <div class="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 class="heading-display-md">Модерация</h1>
        <p class="mt-1 text-sm text-(--color-muted-foreground)">
          Свайп вправо — оставить, влево — скрыть, ★ — в избранное
        </p>
      </div>
      <div class="text-right">
        <p class="font-display text-2xl">{{ processed }} / {{ total }}</p>
        <p class="text-[10px] uppercase tracking-widest text-(--color-muted-foreground)">обработано</p>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="mb-6 h-1.5 overflow-hidden rounded-full bg-(--color-muted)">
      <div
        class="h-full rounded-full bg-(--color-primary) transition-all duration-500"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <!-- Empty state -->
    <div v-if="total === 0" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <h2 class="text-xl">Фото ещё не загружены</h2>
      <p class="mt-2 text-(--color-muted-foreground)">Подождите гостей — после первой загрузки можно начать модерацию.</p>
    </div>

    <!-- All done -->
    <div v-else-if="!current" class="surface-card rounded-(--radius-xl) p-10 text-center">
      <div class="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-(--color-primary) text-white">
        <svg viewBox="0 0 24 24" class="h-7 w-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 class="text-xl">Готово!</h2>
      <p class="mt-2 text-(--color-muted-foreground)">Вы просмотрели все фото.</p>
      <button
        v-if="lastAction"
        type="button"
        class="mt-5 inline-flex h-10 items-center gap-2 rounded-full border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
        @click="undo"
      >
        <Undo2 class="h-4 w-4" />
        Отменить последнее
      </button>
    </div>

    <!-- Card stack -->
    <div v-else class="relative mx-auto aspect-[3/4] max-w-sm">
      <!-- Next card (peek) -->
      <div
        v-if="next"
        class="absolute inset-0 rounded-md bg-white p-3 shadow-lg"
        style="transform: scale(0.94) translateY(8px); opacity: 0.6;"
      >
        <img
          :src="photoUrl(next.id)"
          alt=""
          class="block h-full w-full rounded-sm object-cover"
        >
      </div>

      <!-- Top card -->
      <motion.div
        :key="current.id"
        :drag="'x'"
        :drag-elastic="0.7"
        :drag-constraints="{ left: -300, right: 300 }"
        :style="{ x, rotate, opacity }"
        :while-tap="{ scale: 0.98 }"
        class="absolute inset-0 cursor-grab rounded-md bg-white p-3 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.35)] active:cursor-grabbing"
        @pan-end="onDragEnd"
      >
        <div class="relative h-full w-full overflow-hidden rounded-sm">
          <img
            :src="photoUrl(current.id)"
            alt=""
            class="block h-full w-full object-cover"
          >

          <!-- HIDE / KEEP tags -->
          <motion.div
            :style="{ opacity: hideTagOpacity }"
            class="absolute left-4 top-4 rotate-[-12deg] rounded-md border-4 border-red-500 px-4 py-2 font-display text-2xl font-semibold text-red-500"
          >СКРЫТЬ</motion.div>
          <motion.div
            :style="{ opacity: keepTagOpacity }"
            class="absolute right-4 top-4 rotate-[12deg] rounded-md border-4 border-emerald-500 px-4 py-2 font-display text-2xl font-semibold text-emerald-500"
          >ОСТАВИТЬ</motion.div>

          <!-- Highlight star indicator if already highlighted -->
          <div
            v-if="current.is_highlight"
            class="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-amber-400 text-white shadow-md"
          >
            <Star class="h-5 w-5 fill-current" />
          </div>

          <!-- Bottom caption -->
          <div
            class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10 text-white"
          >
            <p class="text-sm">
              <span v-if="current.guest_name">{{ current.guest_name }}</span>
              <span v-else class="text-white/70">гость</span>
              <span v-if="current.guest_table"> · стол {{ current.guest_table }}</span>
            </p>
          </div>
        </div>
      </motion.div>
    </div>

    <!-- Action buttons -->
    <div v-if="current" class="mt-8 flex items-center justify-center gap-4">
      <button
        type="button"
        aria-label="Скрыть"
        :disabled="decisionInFlight"
        class="grid h-14 w-14 place-items-center rounded-full border-2 border-red-200 bg-white text-red-500 shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        @click="commit('hidden')"
      >
        <X class="h-7 w-7" :stroke-width="2.2" />
      </button>

      <button
        type="button"
        aria-label="В избранное"
        :disabled="decisionInFlight"
        class="grid h-12 w-12 place-items-center rounded-full border-2 border-amber-200 bg-white text-amber-500 shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        @click="commit('highlighted')"
      >
        <Star class="h-6 w-6" :stroke-width="2" />
      </button>

      <button
        type="button"
        aria-label="Отменить"
        :disabled="!lastAction || decisionInFlight"
        class="grid h-12 w-12 place-items-center rounded-full border border-(--color-border) bg-white text-(--color-muted-foreground) shadow-sm transition-transform hover:scale-105 active:scale-95 disabled:opacity-30"
        @click="undo"
      >
        <Undo2 class="h-5 w-5" />
      </button>

      <button
        type="button"
        aria-label="Оставить"
        :disabled="decisionInFlight"
        class="grid h-14 w-14 place-items-center rounded-full border-2 border-emerald-200 bg-white text-emerald-500 shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        @click="commit('kept')"
      >
        <Heart class="h-7 w-7" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>
