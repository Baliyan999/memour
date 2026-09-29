/**
 * Download a QR-cards PDF (/api/admin/qr-pdf/… or /api/couple/qr-pdf/…)
 * as a file, with a pending flag for the button.
 *
 * A plain <a href> would dump the server's JSON error into a new tab
 * when something goes wrong; fetching first lets the caller show a
 * localized toast instead. Errors are thrown as { statusCode, data }
 * with the same shape $fetch uses, so useErrorMessage() works on them.
 *
 *   const { pending, download } = useQrPdfDownload()
 *   try { await download(url) } catch (e) { toast.error(errorMessage(e)) }
 */
import { ref } from 'vue'

function filenameFrom(disposition: string | null): string {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (star) {
    try { return decodeURIComponent(star) } catch { /* fall through */ }
  }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? 'memour-qr.pdf'
}

export function useQrPdfDownload() {
  const pending = ref(false)

  async function download(url: string): Promise<void> {
    if (pending.value) return
    pending.value = true
    try {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw { statusCode: res.status, data: body }
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = filenameFrom(res.headers.get('content-disposition'))
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Give the browser time to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(href), 60_000)
    } finally {
      pending.value = false
    }
  }

  return { pending, download }
}
