/**
 * uploadWithProgress — like $fetch POST, but reports upload progress
 * via XMLHttpRequest (fetch() can't observe request body upload).
 *
 * uploadWithRetry — the same, plus what a guest on venue Wi-Fi needs:
 * a stall timeout, automatic retries with exponential backoff (and
 * Retry-After) for network drops / 5xx / 429, and cancel via an
 * AbortSignal. The caller keeps its blob until the result is ok, and
 * sends the same upload_id on every attempt so the server can drop
 * duplicates of a request whose response got lost.
 *
 * Usage:
 *   const res = await uploadWithRetry<{ ok: boolean }>(
 *     '/api/guest/upload',
 *     () => buildFormData(),
 *     { onProgress: (pct) => (progress.value = pct), signal: ac.signal },
 *   )
 *   if (!res.ok) showError(res.error?.code)
 *
 * Errors carry a stable `code` only — server codes as-is, plus
 * network_error / timeout / aborted from the client. Never prose.
 */
export interface UploadResult<T> {
  ok: boolean
  status: number
  data: T | null
  error: { code: string; retryAfterMs?: number } | null
}

export interface UploadOptions {
  onProgress?: (percent: number) => void
  signal?: AbortSignal
  /** Abort if no bytes move for this long while sending. */
  stallTimeoutMs?: number
  /** Abort if the server hasn't answered this long after the last byte. */
  responseTimeoutMs?: number
}

export function uploadWithProgress<T = any>(
  url: string,
  body: FormData,
  opts: UploadOptions = {},
): Promise<UploadResult<T>> {
  const { onProgress, signal, stallTimeoutMs = 30_000, responseTimeoutMs = 60_000 } = opts
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, status: 0, data: null, error: { code: 'aborted' } })
      return
    }

    const xhr = new XMLHttpRequest()
    let settled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const finish = (r: UploadResult<T>) => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    // Re-armed on every progress event: a slow but moving upload is
    // fine, a silent one (packets vanishing on the venue Wi-Fi while
    // TCP stays up) is not.
    const arm = (ms: number) => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => {
        xhr.abort()
        finish({ ok: false, status: 0, data: null, error: { code: 'timeout' } })
      }, ms)
    }
    const onAbort = () => {
      xhr.abort()
      finish({ ok: false, status: 0, data: null, error: { code: 'aborted' } })
    }
    signal?.addEventListener('abort', onAbort)

    xhr.open('POST', url, true)

    xhr.upload.addEventListener('progress', (e) => {
      arm(stallTimeoutMs)
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })
    xhr.upload.addEventListener('load', () => arm(responseTimeoutMs))

    xhr.addEventListener('load', () => {
      let json: any = null
      try { json = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { /* not JSON (proxy error page) */ }
      const ok = xhr.status >= 200 && xhr.status < 300
      const retryAfter = Number(xhr.getResponseHeader('Retry-After'))
      const serverCode = json?.data?.code ?? json?.code
      finish({
        ok,
        status: xhr.status,
        data: ok ? (json as T) : null,
        error: ok ? null : {
          code: typeof serverCode === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(serverCode)
            ? serverCode
            : codeForStatus(xhr.status),
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
        },
      })
    })

    xhr.addEventListener('error', () => {
      finish({ ok: false, status: 0, data: null, error: { code: 'network_error' } })
    })

    xhr.addEventListener('abort', () => {
      finish({ ok: false, status: 0, data: null, error: { code: 'aborted' } })
    })

    arm(stallTimeoutMs)
    xhr.send(body)
  })
}

/** A code for responses that didn't come with one (e.g. nginx's HTML 413). */
function codeForStatus(status: number): string {
  if (status === 413) return 'file_too_large'
  if (status === 415) return 'unsupported_mime'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'upload_failed'
}

const RETRYABLE_STATUS = new Set([0, 408, 429, 500, 502, 503, 504])

function isRetryable(r: UploadResult<unknown>): boolean {
  if (r.ok) return false
  const code = r.error?.code
  if (code === 'aborted') return false
  // Answers that won't change on retry, even with a 5xx-ish status.
  if (code === 'quota_exceeded' || code === 'storage_error') return false
  return RETRYABLE_STATUS.has(r.status)
}

function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const done = (v: boolean) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const onAbort = () => done(false)
    const timer = setTimeout(() => done(true), ms)
    signal?.addEventListener('abort', onAbort)
  })
}

export async function uploadWithRetry<T = any>(
  url: string,
  makeBody: () => FormData,
  opts: UploadOptions & {
    maxAttempts?: number
    /** Called before each retry wait: attempt number (2…) and the delay. */
    onRetry?: (attempt: number, delayMs: number) => void
  } = {},
): Promise<UploadResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 4
  let result: UploadResult<T> = { ok: false, status: 0, data: null, error: { code: 'upload_failed' } }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    result = await uploadWithProgress<T>(url, makeBody(), opts)
    if (!isRetryable(result) || attempt === maxAttempts) return result
    // 1 s, 2 s, 4 s … ±25 % jitter so a room full of guests who lost
    // Wi-Fi together don't all come back on the same millisecond.
    const backoff = Math.min(8_000, 1_000 * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5)
    const delay = Math.min(15_000, Math.max(backoff, result.error?.retryAfterMs ?? 0))
    opts.onRetry?.(attempt + 1, delay)
    opts.onProgress?.(0)
    if (!(await sleep(delay, opts.signal))) {
      return { ok: false, status: 0, data: null, error: { code: 'aborted' } }
    }
  }
  return result
}
