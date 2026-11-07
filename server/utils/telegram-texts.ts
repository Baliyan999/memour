import { escapeHtml } from './telegram'

/**
 * What the Memour bot says to couples, in both site languages. The
 * site's own texts live in i18n/locales; these never reach a page, only
 * Telegram (HTML parse mode — every value from the database goes
 * through escapeHtml, links are built by the server).
 *
 * Short and warm, one idea per message, the couple's wedding named so a
 * chat that follows several weddings knows which one it is about.
 * Never a guest's name. Uzbek uses the ASCII apostrophe, like the site.
 */
export type BotLocale = 'uz' | 'ru'

export interface MediaCounts {
  photo: number
  video: number
  voice: number
}

/** Telegram's language_code → ours; null when it is neither. */
export function botLocaleOf(code: unknown): BotLocale | null {
  const c = String(code ?? '').toLowerCase()
  if (c.startsWith('ru')) return 'ru'
  if (c.startsWith('uz')) return 'uz'
  return null
}

const link = (href: string, label: string) => `<a href="${href}">${label}</a>`
const wedding = (names: string) => `«${escapeHtml(names)}»`

/** 1 голосовое, 2 голосовых, 5 голосовых, 21 голосовое. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const d10 = n % 10
  const d100 = n % 100
  if (d10 === 1 && d100 !== 11) return one
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few
  return many
}

function countsLine(locale: BotLocale, c: MediaCounts): string {
  const parts: string[] = []
  if (locale === 'ru') {
    if (c.photo) parts.push(`${c.photo} фото`)
    if (c.video) parts.push(`${c.video} видео`)
    if (c.voice) parts.push(`${c.voice} ${ruPlural(c.voice, 'голосовое', 'голосовых', 'голосовых')}`)
  } else {
    if (c.photo) parts.push(`${c.photo} ta surat`)
    if (c.video) parts.push(`${c.video} ta video`)
    if (c.voice) parts.push(`${c.voice} ta ovozli xabar`)
  }
  return parts.join(', ')
}

export const botText = {
  /** "/start <token>" worked. `draft`: not paid yet, so the payment notice is still to come. */
  linked(locale: BotLocale, p: { names: string; href: string; draft: boolean }): string {
    if (locale === 'ru') {
      return [
        `Готово! Буду присылать новости о свадьбе ${wedding(p.names)} 💍`,
        '',
        'Что будет приходить сюда:',
        '• новые фото, видео и голосовые от гостей — сводкой, не чаще раза в 10 минут;',
        ...(p.draft ? ['• сообщение, когда оплата пройдёт и всё будет готово;'] : []),
        '• напоминания скачать архив — за 30 и за 7 дней до удаления.',
        '',
        `${link(p.href, 'Открыть кабинет')} · отключить: /stop`,
      ].join('\n')
    }
    return [
      `Tayyor! ${wedding(p.names)} to'yi yangiliklarini shu yerga yuborib turaman 💍`,
      '',
      'Bu yerga nimalar keladi:',
      "• mehmonlarning yangi suratlari, videolari va ovozli xabarlari — jamlab, 10 daqiqada ko'pi bilan bir marta;",
      ...(p.draft ? ["• to'lov o'tib, hammasi tayyor bo'lganda xabar;"] : []),
      "• arxivni yuklab olish eslatmasi — o'chirilishidan 30 va 7 kun oldin.",
      '',
      `${link(p.href, 'Kabinetni ochish')} · o'chirish: /stop`,
    ].join('\n')
  },

  /** Unknown, used or expired token. */
  linkExpired(locale: BotLocale, p: { href: string }): string {
    return locale === 'ru'
      ? 'Эта ссылка уже не работает: она действует 15 минут и только один раз. '
        + `Откройте ${link(p.href, 'кабинет Memour')} и нажмите «Подключить Telegram» ещё раз.`
      : "Bu havola endi ishlamaydi: u 15 daqiqa va faqat bir marta amal qiladi. "
        + `${link(p.href, 'Memour kabinetini')} oching va «Telegramni ulash» tugmasini yana bosing.`
  },

  /** The wedding's tier doesn't include the bot (downgraded after the link was made). */
  notInPlan(locale: BotLocale): string {
    return locale === 'ru'
      ? 'Уведомления в Telegram входят в тарифы Pro, Premium и Luxury. Чтобы сменить тариф, напишите нам: hello@memour.uz'
      : "Telegram bildirishnomalari Pro, Premium va Luxury tariflariga kiradi. Tarifni almashtirish uchun bizga yozing: hello@memour.uz"
  },

  /** The database failed while linking. */
  linkFailed(locale: BotLocale): string {
    return locale === 'ru'
      ? 'Не получилось подключить уведомления. Попробуйте через минуту: нажмите «Подключить Telegram» в кабинете ещё раз.'
      : "Bildirishnomalarni ulab bo'lmadi. Bir daqiqadan so'ng kabinetda «Telegramni ulash» tugmasini yana bosing."
  },

  /** "/start" with nothing after it — both languages, we don't know the person yet. */
  greeting(p: { uzHref: string; ruHref: string }): string {
    return [
      'Assalomu alaykum! Men Memour botiman 🤍',
      "To'y bildirishnomalari Memour kabinetida ulanadi: to'y sahifasidagi «Telegramni ulash» tugmasini bosing.",
      link(p.uzHref, 'Kabinetni ochish'),
      '',
      'Здравствуйте! Я бот Memour 🤍',
      'Уведомления о свадьбе подключаются в кабинете Memour: нажмите «Подключить Telegram» на странице свадьбы.',
      link(p.ruHref, 'Открыть кабинет'),
    ].join('\n')
  },

  /** /help and any other text. `names`: the weddings this chat follows. */
  help(locale: BotLocale, p: { names: string[]; href: string }): string {
    const following = p.names.map(wedding).join(', ')
    const several = p.names.length > 1
    if (locale === 'ru') {
      return [
        following
          ? `Я присылаю сюда новости ${several ? 'о свадьбах' : 'о свадьбе'} ${following}: новые кадры от гостей, оплату и напоминания скачать архив.`
          : 'Я бот Memour: присылаю паре новые кадры от гостей, сообщаю об оплате и напоминаю скачать архив.',
        'Отвечать на сообщения я не умею — всё управление в кабинете.',
        '',
        link(p.href, 'Открыть кабинет'),
        following ? '/stop — отключить уведомления в этом чате' : 'Подключить уведомления: кнопка «Подключить Telegram» на странице свадьбы.',
      ].join('\n')
    }
    return [
      following
        ? `Bu yerga ${following} ${several ? "to'ylari" : "to'yi"} yangiliklarini yuboraman: mehmonlarning yangi kadrlari, to'lov va arxivni yuklab olish eslatmalari.`
        : "Men Memour botiman: juftlikka mehmonlarning yangi kadrlarini yuboraman, to'lov haqida xabar beraman va arxivni yuklab olishni eslataman.",
      "Xabarlarga javob bera olmayman — hammasi kabinetda boshqariladi.",
      '',
      link(p.href, 'Kabinetni ochish'),
      following ? "/stop — bu chatda bildirishnomalarni o'chirish" : "Bildirishnomalarni ulash: to'y sahifasidagi «Telegramni ulash» tugmasi.",
    ].join('\n')
  },

  /** /stop. `count`: links it closed. */
  stopped(locale: BotLocale, count: number): string {
    if (locale === 'ru') {
      return count > 0
        ? 'Готово — уведомления отключены, больше не буду сюда писать. Подключить снова можно в кабинете Memour.'
        : 'Этот чат и так не получает уведомлений. Подключить их можно в кабинете Memour.'
    }
    return count > 0
      ? "Tayyor — bildirishnomalar o'chirildi, bu yerga boshqa yozmayman. Qayta ulash Memour kabinetida."
      : "Bu chat bildirishnomalar olmaydi. Ularni Memour kabinetida ulash mumkin."
  },

  /** The couple pressed "Uzish / Отключить" in the dashboard. */
  unlinkedFromDashboard(locale: BotLocale, p: { names: string }): string {
    return locale === 'ru'
      ? `Уведомления о свадьбе ${wedding(p.names)} отключены в кабинете Memour. Больше не буду писать сюда о ней.`
      : `${wedding(p.names)} to'yi bildirishnomalari Memour kabinetida o'chirildi. Bu to'y haqida boshqa yozmayman.`
  },

  /** Digest of guest uploads since the last one. */
  digest(locale: BotLocale, p: { names: string; href: string; counts: MediaCounts }): string {
    return locale === 'ru'
      ? `📸 Новые кадры: ${countsLine('ru', p.counts)}\nСвадьба ${wedding(p.names)} · ${link(p.href, 'открыть альбом')}`
      : `📸 Yangi kadrlar: ${countsLine('uz', p.counts)}\n${wedding(p.names)} to'yi · ${link(p.href, 'albomni ochish')}`
  },

  /** The event went draft → active after a payment. */
  activated(locale: BotLocale, p: { names: string; href: string }): string {
    return locale === 'ru'
      ? `💳 Оплата прошла — всё готово! Свадьба ${wedding(p.names)} активна: QR-коды для столов уже можно скачать в кабинете.\n${link(p.href, 'Открыть кабинет')}`
      : `💳 To'lov o'tdi — hammasi tayyor! ${wedding(p.names)} to'yi faol: stollar uchun QR-kodlarni kabinetdan yuklab olishingiz mumkin.\n${link(p.href, 'Kabinetni ochish')}`
  },

  /** 30 / 7 days before archive_expires_at. `date` is already formatted for the locale. */
  archiveReminder(locale: BotLocale, p: { names: string; href: string; days: number; date: string; last: boolean }): string {
    if (locale === 'ru') {
      const days = `${p.days} ${ruPlural(p.days, 'день', 'дня', 'дней')}`
      return p.last
        ? `⏳ Осталось ${days}: ${p.date} альбом свадьбы ${wedding(p.names)} будет удалён навсегда. Успейте скачать архив.\n${link(p.href, 'Скачать архив')}`
        : `⏳ Через ${days}, ${p.date}, альбом свадьбы ${wedding(p.names)} будет удалён навсегда. Скачайте архив заранее — это займёт пару минут.\n${link(p.href, 'Скачать архив')}`
    }
    return p.last
      ? `⏳ ${p.days} kun qoldi: ${p.date} ${wedding(p.names)} to'yi albomi butunlay o'chiriladi. Arxivni yuklab olishga ulguring.\n${link(p.href, 'Arxivni yuklab olish')}`
      : `⏳ ${p.days} kundan keyin, ${p.date}, ${wedding(p.names)} to'yi albomi butunlay o'chiriladi. Arxivni oldindan yuklab oling — bir necha daqiqa oladi.\n${link(p.href, 'Arxivni yuklab olish')}`
  },
}
