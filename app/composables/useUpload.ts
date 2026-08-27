/**
 * uploadWithProgress — like $fetch POST, but reports upload progress
 * via XMLHttpRequest (fetch() can't observe request body upload).
 *
 * Usage:
 *   const { ok, data } = await uploadWithProgress<{ ok: boolean }>(
 *     '/api/guest/upload',
 *     formData,
 *     (pct) => (progress.value = pct),
 *   )
 */
export interface UploadResult<T> {
  ok: boolean
  status: number
  data: T | null
  error: { code?: string, message?: string } | null
}

export function uploadWithProgress<T = any>(
  url: string,
  body: FormData,
  onProgress?: (percent: number) => void,
): Promise<UploadResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url, true)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      let json: any = null
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null }
      catch { /* */ }
      const ok = xhr.status >= 200 && xhr.status < 300
      resolve({
        ok,
        status: xhr.status,
        data: ok ? (json as T) : null,
        error: ok
          ? null
          : {
              code: json?.data?.code ?? json?.code,
              message: json?.statusMessage ?? json?.message ?? `HTTP ${xhr.status}`,
            },
      })
    })

    xhr.addEventListener('error', () => {
      resolve({ ok: false, status: 0, data: null, error: { code: 'network_error' } })
    })

    xhr.addEventListener('abort', () => {
      resolve({ ok: false, status: 0, data: null, error: { code: 'aborted' } })
    })

    xhr.send(body)
  })
}
