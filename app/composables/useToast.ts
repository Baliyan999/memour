/**
 * Tiny toast notification system. Components call `toast()` from
 * anywhere; the global <ToastStack /> rendered in app.vue consumes the
 * shared state and renders the actual UI.
 *
 *   const { toast } = useToast()
 *   toast.success('Сохранено')
 *   toast.error('Не получилось загрузить')
 */
import { reactive } from 'vue'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

const state = reactive<{ items: Toast[] }>({ items: [] })
let nextId = 1
const DEFAULT_TTL_MS = 4000

function push(kind: Toast['kind'], message: string, ttl = DEFAULT_TTL_MS) {
  const id = nextId++
  state.items.push({ id, kind, message })
  setTimeout(() => {
    const idx = state.items.findIndex((t) => t.id === id)
    if (idx >= 0) state.items.splice(idx, 1)
  }, ttl)
}

export function useToast() {
  return {
    items: state.items,
    toast: {
      success: (m: string, ttl?: number) => push('success', m, ttl),
      error: (m: string, ttl?: number) => push('error', m, ttl),
      info: (m: string, ttl?: number) => push('info', m, ttl),
    },
    dismiss(id: number) {
      const idx = state.items.findIndex((t) => t.id === id)
      if (idx >= 0) state.items.splice(idx, 1)
    },
  }
}
