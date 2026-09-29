/**
 * Tiny toast notification system. Components call `toast()` from
 * anywhere; the global <ToastStack /> rendered in app.vue consumes the
 * shared state and renders the actual UI.
 *
 *   const { toast } = useToast()
 *   toast.success(t('couple.branding.saved'))
 *   toast.error(t('errors.generic'))
 *
 * Messages must already be translated. Firing the same message again
 * while it is still on screen restarts its timer instead of stacking a
 * duplicate (e.g. several failed requests in a row).
 */
import { reactive } from 'vue'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

const state = reactive<{ items: Toast[] }>({ items: [] })
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 1
const DEFAULT_TTL_MS = 4000
// An error usually needs reading ("…try again in a minute", "…log in
// by phone"); give it time. The × closes it earlier.
const ERROR_TTL_MS = 8000

function remove(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  const idx = state.items.findIndex((t) => t.id === id)
  if (idx >= 0) state.items.splice(idx, 1)
}

function push(kind: Toast['kind'], message: string, ttl = DEFAULT_TTL_MS) {
  const same = state.items.find((t) => t.kind === kind && t.message === message)
  const id = same?.id ?? nextId++
  if (!same) state.items.push({ id, kind, message })
  clearTimeout(timers.get(id))
  timers.set(id, setTimeout(() => remove(id), ttl))
}

export function useToast() {
  return {
    items: state.items,
    toast: {
      success: (m: string, ttl?: number) => push('success', m, ttl),
      error: (m: string, ttl = ERROR_TTL_MS) => push('error', m, ttl),
      info: (m: string, ttl?: number) => push('info', m, ttl),
    },
    dismiss: remove,
  }
}
