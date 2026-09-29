import { timingSafeEqual } from 'node:crypto'
import { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

/**
 * Storage side of one-time login codes, shared by the couple SMS login
 * (`phone_otps`, keyed by phone) and the admin Telegram 2FA
 * (`admin_otps`, keyed by email). Both tables have the same columns and
 * the primary key (key, code_hash).
 *
 * Rules:
 *   - Only the NEWEST open code for a key counts. Once a new code has
 *     been delivered, the older ones are closed (`closeOpenOtps`); if
 *     delivery fails the new row is dropped and the old code still works.
 *   - Every check spends one attempt BEFORE the code is compared
 *     (`spendOtpAttempt`); after OTP_MAX_ATTEMPTS the code is dead and
 *     the user has to request a new one.
 *   - Hashes are compared in constant time (`otpHashMatches`).
 *
 * PostgREST can't express `attempts = attempts + 1`, so the counter is
 * bumped with compare-and-swap on the value we read: parallel guesses
 * race for the same value, only one update matches, the losers re-read.
 * However many requests arrive at once, a code gets at most
 * OTP_MAX_ATTEMPTS comparisons.
 */
export const OTP_MAX_ATTEMPTS = 5

type Db = ReturnType<typeof serverSupabaseServiceRole<Database>>
type OtpTable = 'phone_otps' | 'admin_otps'
type OtpKey = 'phone' | 'email'

export type OtpAttempt =
  // `attempts` already counts this check.
  | { status: 'ok'; codeHash: string; attempts: number }
  | { status: 'none' } // no open, unexpired code
  | { status: 'locked' } // attempts used up
  | { status: 'busy' } // kept losing the race to parallel requests

// Same columns, different generated types — one loose handle keeps the
// builders below readable.
const from = (db: Db, table: OtpTable) => (db as any).from(table)

export async function spendOtpAttempt(
  db: Db,
  table: OtpTable,
  keyCol: OtpKey,
  key: string,
): Promise<OtpAttempt> {
  for (let i = 0; i < 5; i++) {
    const { data: otp, error } = await from(db, table)
      .select('code_hash, attempts')
      .eq(keyCol, key)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!otp) return { status: 'none' }
    const attempts = (otp.attempts ?? 0) as number
    if (attempts >= OTP_MAX_ATTEMPTS) return { status: 'locked' }

    const { data: bumped, error: bumpErr } = await from(db, table)
      .update({ attempts: attempts + 1 })
      .eq(keyCol, key)
      .eq('code_hash', otp.code_hash)
      .eq('attempts', attempts)
      .is('consumed_at', null)
      .select('code_hash')
    if (bumpErr) throw bumpErr
    if (bumped?.length) return { status: 'ok', codeHash: otp.code_hash, attempts: attempts + 1 }
  }
  return { status: 'busy' }
}

/** Mark the code used. False if a parallel request consumed it first. */
export async function consumeOtp(
  db: Db,
  table: OtpTable,
  keyCol: OtpKey,
  key: string,
  codeHash: string,
): Promise<boolean> {
  const { data, error } = await from(db, table)
    .update({ consumed_at: new Date().toISOString() })
    .eq(keyCol, key)
    .eq('code_hash', codeHash)
    .is('consumed_at', null)
    .select('code_hash')
  if (error) throw error
  return !!data?.length
}

/**
 * Close every still-open code for the key issued before `issuedBefore`
 * (the `created_at` of the code just delivered). Comparing by time, not
 * "everything but mine", keeps two parallel sends from closing each
 * other's code: the newer one survives.
 */
export async function closeOpenOtps(
  db: Db,
  table: OtpTable,
  keyCol: OtpKey,
  key: string,
  issuedBefore: string,
) {
  const { error } = await from(db, table)
    .update({ consumed_at: new Date().toISOString() })
    .eq(keyCol, key)
    .lt('created_at', issuedBefore)
    .is('consumed_at', null)
  if (error) throw error
}

/**
 * Insert a fresh code row. `make()` returns a new code + hash each time:
 * the primary key is (key, code_hash), so the rare repeat of an old code
 * for the same key collides (23505) — we just draw another one.
 */
export async function insertOtp(
  db: Db,
  table: OtpTable,
  row: Record<string, unknown>,
  make: () => { code: string; code_hash: string },
): Promise<{ code: string; code_hash: string; created_at: string }> {
  for (let i = 0; i < 3; i++) {
    const fresh = make()
    const { data, error } = await from(db, table)
      .insert({ ...row, code_hash: fresh.code_hash })
      .select('created_at')
      .single()
    if (!error) return { ...fresh, created_at: data.created_at as string }
    if (error.code !== '23505') throw error
  }
  throw new Error(`${table}: could not draw a unique code`)
}

/** Drop a row whose code never reached the user (delivery failed). */
export async function deleteOtp(
  db: Db,
  table: OtpTable,
  keyCol: OtpKey,
  key: string,
  codeHash: string,
) {
  await from(db, table).delete().eq(keyCol, key).eq('code_hash', codeHash)
}

export function otpHashMatches(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}
