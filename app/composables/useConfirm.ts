/**
 * confirmDialog() — replacement for the browser's native
 * `window.confirm()`. Renders a branded modal via <ConfirmDialog />
 * (mounted globally in app.vue) and resolves to true/false.
 *
 *   const ok = await confirmDialog({
 *     title: t('couple.event.archiveTitle'),
 *     description: t('couple.event.confirmArchive'),
 *     confirmLabel: t('couple.event.archiveButton'),
 *     tone: 'danger',
 *   })
 *   if (!ok) return
 *
 * Labels must already be translated; omitted buttons fall back to
 * common.cancel / common.confirm.
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
  // One dialog at a time: a newer prompt cancels the one on screen, so
  // its caller isn't left awaiting forever.
  state.current?.resolve(false)
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
