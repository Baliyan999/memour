/**
 * confirmDialog() — replacement for the browser's native
 * `window.confirm()`. Renders a branded modal via <ConfirmDialog />
 * (mounted globally in app.vue) and resolves to true/false.
 *
 *   const ok = await confirmDialog({
 *     title: 'Удалить событие?',
 *     description: 'Это действие нельзя отменить.',
 *     confirmLabel: 'Удалить',
 *     cancelLabel: 'Отмена',
 *     tone: 'danger',
 *   })
 *   if (!ok) return
 */
import { reactive } from 'vue'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'neutral'
}

interface ActivePrompt extends ConfirmOptions {
  id: number
  resolve: (ok: boolean) => void
}

const state = reactive<{ current: ActivePrompt | null }>({ current: null })
let nextId = 1

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    state.current = { ...opts, id: nextId++, resolve }
  })
}

export function useConfirm() {
  return {
    state,
    decide(ok: boolean) {
      const c = state.current
      if (!c) return
      state.current = null
      c.resolve(ok)
    },
  }
}
