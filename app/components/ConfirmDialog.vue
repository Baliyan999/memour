<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { motion, AnimatePresence, useReducedMotion } from 'motion-v'
import { AlertTriangle } from '@lucide/vue'
import { useI18n } from '#imports'

/**
 * Global confirm modal — mounted once at app.vue. Picks up state from
 * useConfirm() and renders a branded card instead of the OS confirm.
 *
 * Keyboard: focus moves into the dialog (Cancel first for dangerous
 * actions), Tab stays inside, Esc cancels, and focus returns to the
 * trigger on close. The card scales in on a critically damped spring
 * and leaves along the same path.
 */
const { state, decide } = useConfirm()
const { t } = useI18n()
const reduceMotion = useReducedMotion()

const cancelBtn = ref<HTMLButtonElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

watch(() => state.current?.id, async (openId, prevId) => {
  if (openId && !prevId) returnFocus = document.activeElement as HTMLElement | null
  if (openId) {
    await nextTick()
    const target = state.current?.tone === 'danger' ? cancelBtn.value : confirmBtn.value
    target?.focus()
  } else if (prevId) {
    returnFocus?.focus?.()
    returnFocus = null
  }
})

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (!state.current) return
  if (e.key === 'Escape') {
    e.preventDefault()
    decide(false)
  } else if (e.key === 'Tab') {
    // Two buttons: keep focus cycling between them.
    const order = [cancelBtn.value, confirmBtn.value].filter(Boolean) as HTMLElement[]
    const i = order.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    const next = e.shiftKey ? (i <= 0 ? order.length - 1 : i - 1) : (i + 1) % order.length
    order[next]?.focus()
  }
})

const spring = { type: 'spring' as const, bounce: 0, duration: 0.3 }
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
      >
        <motion.div
          :initial="reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }"
          :transition="reduceMotion ? { duration: 0.15 } : spring"
          class="surface-card relative w-full max-w-md rounded-(--radius-xl) p-7 shadow-(--shadow-glow)"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`confirm-title-${state.current.id}`"
          :aria-describedby="state.current.description ? `confirm-desc-${state.current.id}` : undefined"
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
              <h2 :id="`confirm-title-${state.current.id}`" class="font-display text-xl">{{ state.current.title }}</h2>
              <p
                v-if="state.current.description"
                :id="`confirm-desc-${state.current.id}`"
                class="mt-2 text-sm text-(--color-muted-foreground)"
              >
                {{ state.current.description }}
              </p>
            </div>
          </div>

          <div class="mt-6 flex flex-wrap justify-end gap-2">
            <button
              ref="cancelBtn"
              type="button"
              class="inline-flex h-10 items-center rounded-md border border-(--color-border) bg-white px-4 text-sm transition-[background-color,transform] duration-150 hover:bg-(--color-muted) active:scale-[0.97]"
              @click="decide(false)"
            >{{ state.current.cancelLabel ?? t('common.cancel') }}</button>
            <button
              ref="confirmBtn"
              type="button"
              :class="[
                'inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-white transition-[opacity,transform] duration-150 active:scale-[0.97]',
                state.current.tone === 'danger'
                  ? 'bg-red-600 hover:opacity-90'
                  : 'bg-(--color-primary) hover:opacity-90',
              ]"
              @click="decide(true)"
            >{{ state.current.confirmLabel ?? t('common.confirm') }}</button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  </Teleport>
</template>
