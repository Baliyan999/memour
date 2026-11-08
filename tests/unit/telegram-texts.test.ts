import { describe, expect, it } from 'vitest'
import { escapeHtml } from '../../server/utils/telegram'
import { botLocaleOf, botText, type BotLocale } from '../../server/utils/telegram-texts'

const LOCALES: BotLocale[] = ['uz', 'ru']
const HREF = 'https://memour.uz/ru/dashboard/event/1'
// Couple names come from the database and are typed by people.
const HOSTILE = 'Ali & <b>Vali</b> <a href="https://evil.example">x</a>'

/** Every tag in a message must be one the server wrote itself. */
function foreignTags(html: string): string[] {
  return (html.match(/<[^>]*>/g) ?? []).filter((t) => !/^<a href="https:\/\/memour\.uz\/[^"]*">$|^<\/a>$/.test(t))
}

describe('escapeHtml', () => {
  it('escapes what Telegram HTML mode parses', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('escapes & first, so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;')
  })

  it('leaves ordinary names alone', () => {
    expect(escapeHtml("Shahzoda & Temurbek")).toBe('Shahzoda &amp; Temurbek')
    expect(escapeHtml("O'g'iloy — Шахзода")).toBe("O'g'iloy — Шахзода")
  })
})

describe('botLocaleOf', () => {
  it('maps Telegram language codes to ours', () => {
    expect(botLocaleOf('ru')).toBe('ru')
    expect(botLocaleOf('ru-RU')).toBe('ru')
    expect(botLocaleOf('uz')).toBe('uz')
    expect(botLocaleOf('UZ-Latn')).toBe('uz')
  })

  it('returns null for anything else', () => {
    for (const c of ['en', 'kk', '', null, undefined, 42, {}]) expect(botLocaleOf(c)).toBeNull()
  })
})

describe('botText: database values are escaped in both languages', () => {
  const messages = (locale: BotLocale) => ({
    linked: botText.linked(locale, { names: HOSTILE, href: HREF, draft: true }),
    help: botText.help(locale, { names: [HOSTILE, 'Second <i>Wedding</i>'], href: HREF }),
    unlinked: botText.unlinkedFromDashboard(locale, { names: HOSTILE }),
    digest: botText.digest(locale, { names: HOSTILE, href: HREF, counts: { photo: 1, video: 0, voice: 0 } }),
    activated: botText.activated(locale, { names: HOSTILE, href: HREF }),
    reminder: botText.archiveReminder(locale, { names: HOSTILE, href: HREF, days: 7, date: '15.05.2027', last: true }),
  })

  for (const locale of LOCALES) {
    for (const [name, text] of Object.entries(messages(locale))) {
      it(`${locale} ${name}`, () => {
        expect(text).toContain('Ali &amp; &lt;b&gt;Vali&lt;/b&gt;')
        expect(text).not.toContain('<b>Vali</b>')
        expect(foreignTags(text)).toEqual([])
      })
    }
  }
})

describe('botText: wording', () => {
  it('Uzbek uses the ASCII apostrophe, like the site', () => {
    const all = [
      botText.linked('uz', { names: 'A', href: HREF, draft: true }),
      botText.linkExpired('uz', { href: HREF }),
      botText.notInPlan('uz'),
      botText.linkFailed('uz'),
      botText.greeting({ uzHref: HREF, ruHref: HREF }),
      botText.help('uz', { names: [], href: HREF }),
      botText.stopped('uz', 1),
      botText.stopped('uz', 0),
      botText.archiveReminder('uz', { names: 'A', href: HREF, days: 30, date: '1', last: false }),
    ].join('\n')
    expect(all).toContain("'")
    expect(all).not.toMatch(/[‘’ʻʼ`]/)
  })

  it('mentions the payment notice only while the wedding is unpaid', () => {
    for (const locale of LOCALES) {
      const draft = botText.linked(locale, { names: 'A', href: HREF, draft: true })
      const paid = botText.linked(locale, { names: 'A', href: HREF, draft: false })
      expect(draft.split('\n').length).toBe(paid.split('\n').length + 1)
    }
    expect(botText.linked('ru', { names: 'A', href: HREF, draft: true })).toContain('оплата пройдёт')
    expect(botText.linked('ru', { names: 'A', href: HREF, draft: false })).not.toContain('оплата')
  })

  it('lists only the media kinds that arrived', () => {
    const ru = botText.digest('ru', { names: 'A', href: HREF, counts: { photo: 3, video: 0, voice: 2 } })
    expect(ru).toContain('Новые кадры: 3 фото, 2 голосовых\n')
    expect(ru).not.toContain('видео')
    const uz = botText.digest('uz', { names: 'A', href: HREF, counts: { photo: 0, video: 4, voice: 0 } })
    expect(uz).toContain('Yangi kadrlar: 4 ta video\n')
  })

  it('declines Russian numerals correctly', () => {
    const voice = (n: number) =>
      botText.digest('ru', { names: 'A', href: HREF, counts: { photo: 0, video: 0, voice: n } }).split('\n')[0]
    expect(voice(1)).toBe('📸 Новые кадры: 1 голосовое')
    expect(voice(2)).toBe('📸 Новые кадры: 2 голосовых')
    expect(voice(5)).toBe('📸 Новые кадры: 5 голосовых')
    expect(voice(11)).toBe('📸 Новые кадры: 11 голосовых')
    expect(voice(21)).toBe('📸 Новые кадры: 21 голосовое')
    expect(voice(111)).toBe('📸 Новые кадры: 111 голосовых')

    const days = (n: number) =>
      botText.archiveReminder('ru', { names: 'A', href: HREF, days: n, date: 'D', last: true }).split(':')[0]
    expect(days(1)).toBe('⏳ Осталось 1 день')
    expect(days(3)).toBe('⏳ Осталось 3 дня')
    expect(days(7)).toBe('⏳ Осталось 7 дней')
    expect(days(12)).toBe('⏳ Осталось 12 дней')
    expect(days(21)).toBe('⏳ Осталось 21 день')
    expect(days(30)).toBe('⏳ Осталось 30 дней')
  })

  it('names several weddings in /help in the plural', () => {
    expect(botText.help('ru', { names: ['A', 'B'], href: HREF })).toContain('о свадьбах «A», «B»')
    expect(botText.help('ru', { names: ['A'], href: HREF })).toContain('о свадьбе «A»')
    expect(botText.help('uz', { names: ['A', 'B'], href: HREF })).toContain("«A», «B» to'ylari")
    expect(botText.help('ru', { names: [], href: HREF })).not.toContain('/stop')
  })

  it('distinguishes the first and the last archive reminder', () => {
    for (const locale of LOCALES) {
      const first = botText.archiveReminder(locale, { names: 'A', href: HREF, days: 30, date: 'D', last: false })
      const last = botText.archiveReminder(locale, { names: 'A', href: HREF, days: 7, date: 'D', last: true })
      expect(first).not.toBe(last)
      expect(first).toContain(`<a href="${HREF}">`)
      expect(last).toContain(`<a href="${HREF}">`)
    }
  })
})
