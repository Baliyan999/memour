import { createHash, randomInt } from 'node:crypto'

/**
 * Helpers for phone OTP storage. Codes are hashed with SHA-256 +
 * phone (a coarse "salt") so a leak of the phone_otps table doesn't
 * reveal codes in flight. Codes are 6 digits and expire in 5 minutes.
 */

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(phone: string, code: string): string {
  return createHash('sha256').update(`${phone}:${code}`).digest('hex')
}

/**
 * Normalize a phone number to canonical Uzbek format: "+998XXXXXXXXX"
 * (12 chars total). Returns null if the digits don't parse.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  // Accept inputs starting with 998 or with the user portion only.
  const full = digits.startsWith('998') ? digits : `998${digits}`
  if (full.length !== 12) return null
  return `+${full}`
}
