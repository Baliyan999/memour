import { deleteStaleLinkTokens, sendArchiveReminders, serviceClient } from '../utils/telegram-couple'

/**
 * Nitro task `telegram-reminders` — the couple bot's daily run
 * (server/utils/telegram-couple.ts):
 *
 *   1. "download the archive" 30 and 7 days before archive_expires_at,
 *      to the connected chats of Pro+ events that have something to
 *      download — once per event and kind (telegram_notifications);
 *   2. chats of events whose album was purged are disconnected;
 *   3. link tokens expired more than a day ago are deleted.
 *
 * Scheduled from nuxt.config (nitro.scheduledTasks, 05:00 server time —
 * 10:00 in Tashkent on a UTC server); by hand in dev:
 * GET /_nitro/tasks/telegram-reminders
 */
export default defineTask({
  meta: {
    name: 'telegram-reminders',
    description: 'Telegram: archive reminders 30 / 7 days before deletion, housekeeping of links and tokens',
  },
  async run() {
    const admin = serviceClient()
    const summary = await sendArchiveReminders(admin)
    await deleteStaleLinkTokens(admin)
    console.info('[telegram-bot] reminders done', summary)
    return { result: summary }
  },
})
