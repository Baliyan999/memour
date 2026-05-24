<script setup lang="ts">
import { motion, AnimatePresence } from 'motion-v'
import { AlertTriangle } from '@lucide/vue'

/**
 * Global confirm modal — mounted once at app.vue. Picks up state from
 * useConfirm() and renders a branded card instead of the OS confirm.
 */
const { state, decide } = useConfirm()
</script>

<template>
  <Teleport to="body">
    <AnimatePresence>
      <motion.div
        v-if="state.current"
        :key="state.current.id"
        :initial="{ opacity: 0 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.18 }"
        class="fixed inset-0 z-[200] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
        @click.self="decide(false)"
        @keydown.esc="decide(false)"
      >
        <motion.div
          :initial="{ opacity: 0, scale: 0.94, y: 12 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="{ opacity: 0, scale: 0.96, y: 8 }"
          :transition="{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }"
          class="surface-card relative w-full max-w-md rounded-(--radius-xl) p-7 shadow-(--shadow-glow)"
          role="dialog"
          aria-modal="true"
        >
          <div class="flex items-start gap-4">
            <div
              :class="[
                'grid h-11 w-11 shrink-0 place-items-center rounded-full',
                state.current.tone === 'danger'
                  ? 'bg-red-100 text-red-600'
                  : 'bg-(--color-accent)/40 text-(--color-primary)',
              ]"
            >
              <AlertTriangle class="h-5 w-5" :stroke-width="1.8" />
            </div>
            <div class="min-w-0 flex-1">
              <h2 class="font-display text-xl">{{ state.current.title }}</h2>
              <p v-if="state.current.description" class="mt-2 text-sm text-(--color-muted-foreground)">
                {{ state.current.description }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex justify-end gap-2">
            <button
              type="button"
              class="inline-flex h-10 items-center rounded-md border border-(--color-border) bg-white px-4 text-sm hover:bg-(--color-muted)"
              @click="decide(false)"
            >{{ state.current.cancelLabel ?? 'Отмена' }}</button>
            <button
              type="button"
              :class="[
                'inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-white',
                state.current.tone === 'danger'
                  ? 'bg-red-600 hover:opacity-90'
                  : 'bg-(--color-primary) hover:opacity-90',
              ]"
              @click="decide(true)"
            >{{ state.current.confirmLabel ?? 'Подтвердить' }}</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
