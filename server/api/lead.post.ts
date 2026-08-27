import type { Database } from '~/types/database.types'
import { z } from 'zod'
import { serverSupabaseServiceRole } from '#supabase/server'

/**
 * POST /api/lead — landing page contact form submission. Validates,
 * inserts into the `leads` table via the service-role client (RLS is
 * on, anonymous inserts go through the privileged role on the server),
 * and forwards a brief notification to the configured Telegram chat.
 * Telegram failures are swallowed so a temporary bot outage doesn't
 * block a real lead from landing in the DB.
 */
const leadSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+0-9()\s-]+$/, 'invalid phone'),
  wedding_date: z.string().date().nullable().optional(),
  guests_estimate: z.number().int().min(10).max(1000).nullable().optional(),
  source: z.string().max(40).optional(),
  locale: z.string().max(8).optional(),
})

type LeadInput = z.infer<typeof leadSchema>

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = leadSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid input' }
  }

  const supabase = serverSupabaseServiceRole<Database>(event)
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      name: parsed.data.name,
      phone: parsed.data.phone,
      wedding_date: parsed.data.wedding_date ?? null,
      guests_estimate: parsed.data.guests_estimate ?? null,
      source: parsed.data.source ?? 'landing',
      locale: parsed.data.locale ?? 'uz',
    })
    .select('id')
    .single()
  if (error || !lead) {
    console.error('[lead] insert failed', error)
    return { ok: false, error: 'server error' }
  }

  // Referral attribution. The lead's source field encodes "ref:CODE";
  // if a matching referral row exists, write a referral_attributions
  // record so admin reports can roll up per-partner conversions.
  const src = parsed.data.source ?? ''
  if (src.startsWith('ref:')) {
    const code = src.slice(4).toLowerCase()
    const { data: ref } = await supabase
      .from('referrals')
      .select('id')
      .eq('code', code)
      .maybeSingle()
    if (ref) {
      await supabase
        .from('referral_attributions')
        .insert({ referral_id: ref.id, lead_id: lead.id })
        .then(({ error: aErr }) => {
          if (aErr)
            console.error('[lead] attribution insert', aErr)
        })
    }
  }

  await notifyTelegram(parsed.data).catch((err) => {
    console.error('[lead] telegram notify failed', err)
  })

  return { ok: true }
})

async function notifyTelegram(lead: LeadInput) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_LEAD_CHAT_ID
  if (!token || !chatId)
    return

  const text
    = `🎉 Новая заявка\n`
      + `Имя: ${lead.name}\n`
      + `Тел: ${lead.phone}\n${
        lead.wedding_date ? `Дата: ${lead.wedding_date}\n` : ''
      }${lead.guests_estimate ? `Гостей: ${lead.guests_estimate}\n` : ''
      }${lead.source ? `Источник: ${lead.source}` : ''}`

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}
