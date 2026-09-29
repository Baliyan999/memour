import type { serverSupabaseServiceRole } from '#supabase/server'
import type { Database } from '~/types/database.types'

type ServiceClient = ReturnType<typeof serverSupabaseServiceRole<Database>>
type AuthUser = NonNullable<Awaited<ReturnType<ServiceClient['auth']['admin']['getUserById']>>['data']['user']>

/**
 * Auth-user lookups for the admin back office (service-role client).
 *
 * GoTrue's admin API has no "get by email", and listUsers() without
 * params returns only the first 50 users — every couple's SMS login
 * creates one, so page 1 stops being "everyone" very quickly. We walk
 * the pages and compare emails case-insensitively.
 */
const PER_PAGE = 1000
const MAX_PAGES = 100 // 100k users — far beyond anything we expect

export async function findAuthUserByEmail(
  supabase: ServiceClient,
  email: string,
): Promise<AuthUser | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === target)
    if (hit) return hit
    if (data.users.length < PER_PAGE) return null
  }
  return null
}

/**
 * Couples who log in by SMS get a synthetic auth account
 * "phone+998…@phone.memour.local" (see auth/phone/verify). Those must
 * never become admins or couple-by-email owners.
 */
export function isPhoneAccount(user: { email?: string | null; user_metadata?: Record<string, any> }): boolean {
  return /@phone\.memour\.local$/i.test(user.email ?? '')
    || user.user_metadata?.channel === 'phone-otp'
}
