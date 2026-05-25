import { ref, onMounted, onBeforeUnmount } from 'vue'

/**
 * Opt-in fullscreen for the camera viewport.
 *
 * Hybrid strategy:
 *   1. Try the native Fullscreen API on the element. On Android
 *      Chrome this hides the URL bar and gives a true edge-to-edge
 *      view; on desktop browsers the page content blanks out.
 *   2. ALWAYS also set a reactive `isFull` flag — the template binds
 *      it to a CSS class that pins the viewport with
 *      `position: fixed; inset: 0; z-index: 50; border-radius: 0`.
 *      This is the actual fallback on iOS Safari, where requesting
 *      fullscreen on a live MediaStream <video> doesn't reliably
 *      work. The CSS path covers every browser unchanged.
 *
 * If the user exits the native fullscreen (Esc, swipe-down, etc.)
 * the `fullscreenchange` listener clears our flag so the CSS state
 * stays in sync.
 */
export function useFullscreen() {
  const isFull = ref(false)
  let target: HTMLElement | null = null

  async function enter(el: HTMLElement) {
    target = el
    isFull.value = true
    try {
      const anyEl = el as any
      if (anyEl.requestFullscreen) {
        await anyEl.requestFullscreen()
      } else if (anyEl.webkitRequestFullscreen) {
        anyEl.webkitRequestFullscreen()
      }
    } catch {
      // Native API failed (most common on iOS Safari). The CSS path
      // already kicked in via `isFull = true`, so we're done.
    }
  }

  async function exit() {
    isFull.value = false
    try {
      const anyDoc = document as any
      if (anyDoc.fullscreenElement && anyDoc.exitFullscreen) {
        await anyDoc.exitFullscreen()
      } else if (anyDoc.webkitFullscreenElement && anyDoc.webkitExitFullscreen) {
        anyDoc.webkitExitFullscreen()
      }
    } catch {
      // ignore — flag is already false
    }
  }

  function toggle(el: HTMLElement) {
    if (isFull.value) void exit()
    else void enter(el)
  }

  function onFsChange() {
    const anyDoc = document as any
    const stillFs = !!(anyDoc.fullscreenElement || anyDoc.webkitFullscreenElement)
    if (!stillFs && isFull.value) {
      // User exited via Esc / swipe — clear our flag so the CSS
      // class drops and the viewport returns to flex flow.
      isFull.value = false
    }
  }

  onMounted(() => {
    if (typeof document === 'undefined') return
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
  })
  onBeforeUnmount(() => {
    if (typeof document === 'undefined') return
    document.removeEventListener('fullscreenchange', onFsChange)
    document.removeEventListener('webkitfullscreenchange', onFsChange)
    if (isFull.value && target) void exit()
  })

  return { isFull, enter, exit, toggle }
}
