<script setup lang="ts">
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { Check, X, Info } from '@lucide/vue'
import { useI18n } from '#imports'

/**
 * Global toast container. Mounted once at app.vue. Subscribes to the
 * shared toast state via useToast() — components anywhere can fire
 * toast.success() / toast.error() / toast.info().
 *
 * The container is a polite live region; errors are role="alert" so
 * screen readers announce them immediately. Toasts drop in from the
 * top and leave the same way, on a critically damped spring; `layout`
 * lets the remaining ones glide into place instead of jumping.
 */
const { items, dismiss } = useToast()
const { t } = useI18n()
const reduceMotion = useReducedMotion()

const colorClass = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  info: 'border-(--color-border) bg-white text-(--color-foreground)',
}
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:top-6"
      aria-live="polite"
    >
      <AnimatePresence>
        <motion.div
          v-for="item in items"
          :key="item.id"
          layout
          :initial="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }"
          :animate="{ opacity: 1, y: 0, scale: 1 }"
          :exit="reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }"
          :transition="reduceMotion ? { duration: 0.15 } : { type: 'spring', bounce: 0, duration: 0.35 }"
          :role="item.kind === 'error' ? 'alert' : 'status'"
          :class="['pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border p-3 shadow-(--shadow-soft)', colorClass[item.kind]]"
        >
          <div class="grid h-5 w-5 shrink-0 place-items-center rounded-full">
            <Check v-if="item.kind === 'success'" class="h-4 w-4" :stroke-width="2.4" />
            <X v-else-if="item.kind === 'error'" class="h-4 w-4" :stroke-width="2.4" />
            <Info v-else class="h-4 w-4" :stroke-width="2" />
          </div>
          <p class="flex-1 text-sm">{{ item.message }}</p>
          <button
            type="button"
            :aria-label="t('common.close')"
            class="-m-1 ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-full opacity-50 transition-[opacity,transform] duration-150 hover:opacity-100 active:scale-90"
            @click="dismiss(item.id)"
          >
            <X class="h-4 w-4" :stroke-width="2" />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  </Teleport>
</template>
