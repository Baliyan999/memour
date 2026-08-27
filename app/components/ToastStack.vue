<script setup lang="ts">
import { Check, Info, X } from '@lucide/vue'
import { AnimatePresence, motion } from 'motion-v'

/**
 * Global toast container. Mounted once at app.vue. Subscribes to the
 * shared toast state via useToast() — components anywhere can fire
 * toast.success() / toast.error() / toast.info().
 */
const { items, dismiss } = useToast()

const colorClass = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-(--color-border) bg-white text-(--color-foreground)',
}
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:top-6">
      <AnimatePresence>
        <motion.div
          v-for="t in items"
          :key="t.id"
          :initial="{ opacity: 0, y: -16, scale: 0.96 }"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :exit="{ opacity: 0, y: -8, scale: 0.96 }"
          :transition="{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border p-3 shadow-(--shadow-soft)" :class="[colorClass[t.kind]]"
        >
          <div class="grid h-5 w-5 shrink-0 place-items-center rounded-full">
            <Check v-if="t.kind === 'success'" class="h-4 w-4" :stroke-width="2.4" />
            <X v-else-if="t.kind === 'error'" class="h-4 w-4" :stroke-width="2.4" />
            <Info v-else class="h-4 w-4" :stroke-width="2" />
          </div>
          <p class="flex-1 text-sm">
            {{ t.message }}
          </p>
          <button
            type="button"
            aria-label="Закрыть"
            class="ml-2 opacity-50 hover:opacity-100"
            @click="dismiss(t.id)"
          >
            <X class="h-4 w-4" :stroke-width="2" />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  </Teleport>
</template>
