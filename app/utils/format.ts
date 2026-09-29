import { format } from 'date-fns'
import { ru as ruLocale, uz as uzLocale } from 'date-fns/locale'

/**
 * A YYYY-MM-DD date (or the date part of a timestamp) for the couple
 * pages: "28-sentabr, 2026" / "28 сентября 2026".
 *
 * date-fns instead of toLocaleDateString: Chrome's bundled ICU has no
 * Uzbek month names ("2026 M09 28") and disagrees with the server.
 */
export function formatDate(d: string, locale: string): string {
  const date = new Date(`${d.slice(0, 10)}T00:00:00`)
  return locale === 'uz'
    ? format(date, 'd-MMMM, yyyy', { locale: uzLocale }).toLowerCase()
    : format(date, 'd MMMM yyyy', { locale: ruLocale })
}

/** Clip length as m:ss ("0:07", "1:30"); empty when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * An Uzbek number as people write it: "+998971234567" (how leads are
 * stored, for de-duplication) → "+998 97 123 45 67". Anything else is
 * shown as stored.
 */
export function formatPhone(phone: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone.replace(/[\s()-]/g, ''))
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone
}
