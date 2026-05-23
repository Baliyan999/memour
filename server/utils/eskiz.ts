/**
 * Minimal Eskiz.uz SMS client.
 *
 * Auth flow: POST /auth/login with {email, password} → returns a JWT
 * token. Token is cached for the lifetime of the Nitro process (no
 * refresh logic yet; tokens are valid for ~30 days). On 401 we re-
 * authenticate and retry once.
 *
 * Send flow: POST /message/sms/send with {mobile_phone, message, from}.
 * In Eskiz' test mode the body must match one of three sanctioned
 * templates ("This is test from Eskiz", etc.) — anything else returns
 * an "unauthorized text" error. Once the project's custom template is
 * approved via Eskiz' "Мои тексты" moderation, we can swap in the
 * production message verbatim.
 */
let cachedToken: { value: string; obtainedAt: number } | null = null

async function login(): Promise<string> {
  const base = process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz/api'
  const email = process.env.ESKIZ_EMAIL
  const password = process.env.ESKIZ_PASSWORD
  if (!email || !password) {
    throw new Error('Eskiz credentials missing (ESKIZ_EMAIL/ESKIZ_PASSWORD)')
  }
  const form = new FormData()
  form.append('email', email)
  form.append('password', password)
  const res = await fetch(`${base}/auth/login`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new Error(`Eskiz auth failed: ${res.status} ${await res.text()}`)
  }
  const json: any = await res.json()
  const token = json?.data?.token
  if (!token) throw new Error('Eskiz auth: no token in response')
  cachedToken = { value: token, obtainedAt: Date.now() }
  return token
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.obtainedAt < 25 * 24 * 60 * 60 * 1000) {
    return cachedToken.value
  }
  return login()
}

export interface SendSmsResult {
  ok: boolean
  id?: string | number
  status?: string
  error?: string
}

/**
 * Send a single SMS. Phone must be in +998XXXXXXXXX format (no spaces).
 * On 401 we re-login once and retry.
 */
export async function sendSms(phone: string, message: string): Promise<SendSmsResult> {
  const base = process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz/api'
  const sender = process.env.ESKIZ_SENDER || '4546'
  const cleanPhone = phone.replace(/\D/g, '')

  const send = async (token: string) => {
    const form = new FormData()
    form.append('mobile_phone', cleanPhone)
    form.append('message', message)
    form.append('from', sender)
    return fetch(`${base}/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
  }

  let token = await getToken()
  let res = await send(token)
  if (res.status === 401) {
    cachedToken = null
    token = await login()
    res = await send(token)
  }
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: json?.message || `HTTP ${res.status}` }
  }
  return { ok: true, id: json?.id, status: json?.status }
}
