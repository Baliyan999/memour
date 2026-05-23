<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { motion, AnimatePresence } from 'motion-v'
import type { Database } from '~/types/database.types'

definePageMeta({ layout: 'guest' })

/**
 * /e/[id]/live — live slideshow projected onto the hall screen.
 *
 *   • Subscribes to Supabase Realtime channel `photos:event_id=X`
 *     for INSERT events and prepends to a queue.
 *   • Center stage shows the latest photo at large size for 7 seconds.
 *   • Background mosaic shows the last 12 photos as drifting polaroids.
 *   • Designed for fullscreen on a projector or large display.
 *
 * The slideshow is anonymous: anyone with the URL can watch. The
 * link is shared by the couple via dashboard. UUIDs are unguessable.
 */
const route = useRoute()
const eventId = computed(() => route.params.id as string)

const supabase = useSupabaseClient<Database>()

interface PhotoItem {
  id: string
  uploaded_at: string
  guest_name: string | null
  guest_table: number | null
}

const queue = ref<PhotoItem[]>([])
const featured = ref<PhotoItem | null>(null)
const eventName = ref<string>('')

// Initial load: fetch most recent 24 photos to seed the slideshow,
// plus event metadata for the corner label.
const { data: initial } = await useFetch<{
  event: { couple_names: string }
  photos: PhotoItem[]
}>(`/api/guest/live-init/${eventId.value}`)
if (initial.value) {
  queue.value = initial.value.photos
  eventName.value = initial.value.event.couple_names
  if (queue.value.length > 0) featured.value = queue.value[0]!
}

const photoUrl = (id: string) => `/api/photo/${id}`

let rotateTimer: number | undefined
function rotateFeatured() {
  if (queue.value.length === 0) return
  // Rotate by picking a random recent photo to keep variety even
  // when uploads slow down.
  const pool = queue.value.slice(0, 12)
  const next = pool[Math.floor(Math.random() * pool.length)]!
  featured.value = next
}

let channel: ReturnType<typeof supabase.channel> | null = null

onMounted(() => {
  channel = supabase
    .channel(`photos:event_id=${eventId.value}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'photos',
        filter: `event_id=eq.${eventId.value}`,
      },
      (payload) => {
        const row = payload.new as any
        if (row.is_hidden) return
        const item: PhotoItem = {
          id: row.id,
          uploaded_at: row.uploaded_at,
          guest_name: row.guest_name,
          guest_table: row.guest_table,
        }
        queue.value = [item, ...queue.value].slice(0, 24)
        // New uploads immediately become the featured photo.
        featured.value = item
        // Reset the rotation timer so the new photo gets full
        // attention before we start cycling again.
        if (rotateTimer) clearInterval(rotateTimer)
        rotateTimer = window.setInterval(rotateFeatured, 7_000) as unknown as number
      },
    )
    .subscribe()

  // Start rotation
  rotateTimer = window.setInterval(rotateFeatured, 7_000) as unknown as number
})

onBeforeUnmount(() => {
  if (rotateTimer) clearInterval(rotateTimer)
  if (channel) supabase.removeChannel(channel)
})

useSeoMeta({
  title: () => (eventName.value ? `${eventName.value} · Live` : 'Memour Live'),
})

// Pseudo-random offsets per photo for the background mosaic so it
// feels organic instead of grid-aligned. Computed once per id.
const mosaicStyle = (id: string, i: number) => {
  // Deterministic from photo id so positions don't jump on every
  // rerender; gives each photo a stable home in the mosaic.
  const seed = id.charCodeAt(0) + id.charCodeAt(5) + i
  const rot = ((seed % 16) - 8) * 0.6
  const ty = ((seed * 31) % 12) - 6
  const tx = ((seed * 17) % 12) - 6
  return {
    transform: `translate(${tx}px, ${ty}px) rotate(${rot}deg)`,
  }
}
</script>

<template>
  <div class="relative min-h-[100dvh] overflow-hidden bg-black">
    <!-- Background mosaic — uses thumbnails (much smaller payload). -->
    <div class="absolute inset-0 grid grid-cols-6 gap-2 p-4 opacity-25 sm:gap-3 sm:p-6">
      <AnimatePresence>
        <motion.div
          v-for="(p, i) in queue.slice(0, 12)"
          :key="p.id"
          :initial="{ opacity: 0, scale: 0.7 }"
          :animate="{ opacity: 1, scale: 1 }"
          :exit="{ opacity: 0, scale: 0.7 }"
          :transition="{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }"
          class="aspect-square overflow-hidden rounded-md"
          :style="mosaicStyle(p.id, i)"
        >
          <img
            :src="`${photoUrl(p.id)}?t=thumb`"
            :alt="''"
            class="h-full w-full object-cover"
            loading="lazy"
          >
        </motion.div>
      </AnimatePresence>
    </div>

    <!-- Soft vignette over mosaic -->
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-0"
      style="background: radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.75) 80%);"
    />

    <!-- Featured (center stage) -->
    <div class="relative z-10 grid min-h-[100dvh] place-items-center p-6 sm:p-10">
      <AnimatePresence mode="wait">
        <motion.div
          v-if="featured"
          :key="featured.id"
          :initial="{ opacity: 0, scale: 0.95, y: 40 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="{ opacity: 0, scale: 1.02, y: -20 }"
          :transition="{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }"
          class="relative max-w-[min(85vw,82vh)]"
        >
          <div class="overflow-hidden rounded-lg bg-white p-3 shadow-[0_30px_80px_-10px_rgba(0,0,0,0.6)]">
            <img
              :src="photoUrl(featured.id)"
              :alt="''"
              class="block max-h-[72vh] w-full rounded-md object-cover"
              loading="eager"
            >
            <div class="px-2 pt-3 text-center">
              <p class="font-display italic text-(--color-foreground)" style="font-size: 1.1rem">
                <template v-if="featured.guest_name">от {{ featured.guest_name }}</template>
                <template v-else>гость</template>
                <template v-if="featured.guest_table"> · стол {{ featured.guest_table }}</template>
              </p>
            </div>
          </div>
        </motion.div>
        <div v-else class="text-center text-white/60" key="empty">
          <p class="font-display text-3xl italic">Ждём первый кадр…</p>
        </div>
      </AnimatePresence>
    </div>

    <!-- Corner brand -->
    <div class="absolute right-6 top-6 z-20 text-right text-white/80">
      <p class="text-[10px] uppercase tracking-[0.4em]">Memour Live</p>
      <p v-if="eventName" class="font-display text-xl italic">{{ eventName }}</p>
    </div>

    <!-- Photo count badge -->
    <div class="absolute bottom-6 left-6 z-20 flex items-center gap-2 rounded-full border border-white/20 bg-black/60 px-4 py-2 text-white/90 backdrop-blur">
      <span class="h-2 w-2 animate-pulse rounded-full bg-red-500" />
      <span class="text-xs uppercase tracking-widest">LIVE</span>
      <span class="ml-2 text-sm">{{ queue.length }}</span>
    </div>
  </div>
</template>
