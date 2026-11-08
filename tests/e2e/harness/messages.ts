/**
 * The site's own strings (i18n/locales), so tests assert exactly what a
 * visitor reads — and that it came from i18n, not from the server.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env'

export type Locale = 'uz' | 'ru'

const messages: Record<Locale, unknown> = {
  uz: JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', 'uz.json'), 'utf8')),
  ru: JSON.parse(readFileSync(join(ROOT, 'i18n', 'locales', 'ru.json'), 'utf8')),
}

/** t('uz', 'guest.camera.quotaPhotos', { used: 1, total: 30 }) */
export function t(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages[locale])
  if (typeof value !== 'string') throw new Error(`e2e: no ${locale} message for ${key}`)
  return value.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}
