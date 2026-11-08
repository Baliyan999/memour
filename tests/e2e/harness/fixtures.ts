/**
 * Playwright fixtures every spec uses:
 *
 *   seed     creates this test's rows through the service role, all
 *            marked with a unique prefix, and deletes them afterwards
 *            (storage objects, events and what cascades from them,
 *            leads, admin login codes, auth users, emails). consent_events
 *            is append-only by design (a trigger refuses DELETE for
 *            every role), so the consent records a test writes stay.
 *   context  the browser reaches only this machine: fonts, CDNs and
 *            anything else outside are aborted, so a run never depends
 *            on (or calls) the internet.
 */
import { randomBytes, randomInt } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import { isLocalUrl } from './env'
import { deleteMail } from './mailbox'
import { SupabaseAdmin, type Row } from './supabase'

/** Today in Asia/Tashkent (UTC+5, no DST): the upload window is open all day. */
export function tashkentToday(): string {
  return new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)
}

export class Seed {
  readonly db = new SupabaseAdmin()
  /** e.g. "e2e-3fa9c1d2" — in every name, email and couple this test creates. */
  readonly prefix = `e2e-${randomBytes(4).toString('hex')}`
  private readonly events = new Set<string>()
  private readonly users = new Set<string>()
  private readonly emails = new Set<string>()
  private readonly mails = new Set<string>()

  name(label: string): string {
    return `${this.prefix} ${label}`
  }

  email(label: string): string {
    const email = `${this.prefix}-${label}@e2e.memour.test`
    this.emails.add(email)
    return email
  }

  /** A random Uzbek mobile number, formatted the way the phone field shows it. */
  phone(): string {
    const d = String(randomInt(0, 10_000_000)).padStart(7, '0')
    return `+998 90 ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5)}`
  }

  /** An event, by default active, Pro, wedding today, 10 tables. */
  async event(fields: Row = {}): Promise<Row> {
    const row = await this.db.insert('events', {
      couple_names: this.name('Couple'),
      wedding_date: tashkentToday(),
      status: 'active',
      plan_tier: 'pro',
      table_count: 10,
      ...fields,
    })
    this.events.add(row.id)
    return row
  }

  /** A confirmed auth user. */
  async user(email: string, password?: string): Promise<Row> {
    const user = await this.db.createUser({ email, ...(password ? { password } : {}) })
    this.users.add(user.id)
    return user
  }

  /** An admin as CONTRIBUTING.md sets one up: an auth user with a password plus an admins row with a Telegram chat. */
  async admin(): Promise<{ email: string; password: string; chatId: string; userId: string }> {
    const email = this.email('admin')
    const password = randomBytes(12).toString('hex')
    const chatId = String(randomInt(700_000_000, 799_999_999))
    const user = await this.user(email, password)
    await this.db.insert('admins', { user_id: user.id, role: 'super', telegram_chat_id: chatId })
    return { email, password, chatId, userId: user.id }
  }

  trackMail(id: string): void {
    this.mails.add(id)
  }

  async cleanup(): Promise<void> {
    const problems: string[] = []
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn()
      } catch (e) {
        problems.push(`${what}: ${(e as Error).message}`)
      }
    }
    const like = `like.${encodeURIComponent(this.prefix)}*`

    // Events created through the UI too (none today), found by their name.
    await attempt('find events', async () => {
      for (const e of await this.db.select('events', `select=id&couple_names=${like}`)) this.events.add(e.id)
    })
    for (const id of this.events) {
      for (const bucket of ['photos', 'branding']) {
        await attempt(`storage ${bucket}/${id}`, async () => this.db.removeObjects(bucket, await this.db.listObjects(bucket, `${id}/`)))
      }
    }
    if (this.events.size) {
      // photos, guest_devices, branding and Telegram links cascade.
      await attempt('events', () => this.db.remove('events', `id=in.(${[...this.events].join(',')})`))
    }
    await attempt('leads', () => this.db.remove('leads', `name=${like}`))
    if (this.emails.size) {
      const list = [...this.emails].map((e) => `"${e}"`).join(',')
      await attempt('admin_otps', () => this.db.remove('admin_otps', `email=in.(${encodeURIComponent(list)})`))
    }
    // admins rows cascade with their auth user.
    for (const id of this.users) await attempt(`user ${id}`, () => this.db.deleteUser(id))
    await attempt('mail', () => deleteMail([...this.mails]))

    if (problems.length) throw new Error(`e2e cleanup for ${this.prefix} left data behind:\n${problems.join('\n')}`)
  }
}

export const test = base.extend<{ seed: Seed }>({
  seed: async ({}, use) => {
    const seed = new Seed()
    await use(seed)
    await seed.cleanup()
  },
  context: async ({ context }, use) => {
    await context.route((url) => /^https?:$/.test(url.protocol) && !isLocalUrl(url), (route) => route.abort('blockedbyclient'))
    await use(context)
  },
})

export { expect }
