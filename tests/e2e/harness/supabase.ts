/**
 * Service-role access to the LOCAL Supabase for seeding and cleanup:
 * PostgREST, the Auth admin API and Storage. supabaseEnv() has already
 * refused any URL that is not on this machine.
 */
import { supabaseEnv } from './env'

export type Row = Record<string, any>

export class SupabaseAdmin {
  private readonly url: string
  private readonly key: string

  constructor() {
    const env = supabaseEnv()
    this.url = env.url
    this.key = env.serviceKey
  }

  private async call(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<any> {
    const res = await fetch(`${this.url}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 500)}`)
    return text ? JSON.parse(text) : null
  }

  // --- PostgREST ------------------------------------------------------

  async insert(table: string, row: Row): Promise<Row> {
    const [created] = await this.call(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } })
    return created
  }

  /** `query` is a PostgREST query string, e.g. `select=id&event_id=eq.<uuid>`. */
  select(table: string, query: string): Promise<Row[]> {
    return this.call(`/rest/v1/${table}?${query}`)
  }

  update(table: string, query: string, patch: Row): Promise<Row[]> {
    return this.call(`/rest/v1/${table}?${query}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } })
  }

  remove(table: string, query: string): Promise<Row[]> {
    if (!query.includes('=')) throw new Error(`refusing an unfiltered delete on ${table}`)
    return this.call(`/rest/v1/${table}?${query}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })
  }

  // --- Auth -----------------------------------------------------------

  createUser(attrs: { email: string; password?: string }): Promise<Row> {
    return this.call('/auth/v1/admin/users', { method: 'POST', body: { ...attrs, email_confirm: true } })
  }

  async deleteUser(id: string): Promise<void> {
    await this.call(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }).catch((e: Error) => {
      if (!/→ 404/.test(e.message)) throw e
    })
  }

  // --- Storage --------------------------------------------------------

  /** Every object name under `prefix` (folders are walked). */
  async listObjects(bucket: string, prefix: string): Promise<string[]> {
    const names: string[] = []
    for (let offset = 0; ; offset += 1000) {
      const page: { name: string; id: string | null }[] = await this.call(`/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        body: { prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } },
      })
      for (const item of page) {
        const path = `${prefix}${item.name}`
        if (item.id === null) names.push(...(await this.listObjects(bucket, `${path}/`)))
        else names.push(path)
      }
      if (page.length < 1000) return names
    }
  }

  async removeObjects(bucket: string, names: string[]): Promise<void> {
    for (let i = 0; i < names.length; i += 100) {
      await this.call(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: { prefixes: names.slice(i, i + 100) } })
    }
  }
}
