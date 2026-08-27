/**
 * Nitro startup plugin that validates required environment variables.
 * Logs (but does NOT throw) for optional-but-recommended ones, so
 * local dev keeps booting even with partial config.
 *
 * The hard requirements are: Supabase URL + keys + site URL. Without
 * them auth, storage, and almost every endpoint will 500.
 */
export default defineNitroPlugin(() => {
  const required = [
    'NUXT_PUBLIC_SITE_URL',
    'NUXT_PUBLIC_SUPABASE_URL',
    'NUXT_PUBLIC_SUPABASE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const recommended = [
    'ESKIZ_EMAIL',
    'ESKIZ_PASSWORD',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_LEAD_CHAT_ID',
  ]
  const paymentOptional = [
    'PAYME_MERCHANT_ID',
    'PAYME_MERCHANT_KEY',
    'CLICK_SERVICE_ID',
    'CLICK_MERCHANT_ID',
    'CLICK_SECRET_KEY',
  ]

  const missingRequired = required.filter(k => !process.env[k])
  if (missingRequired.length > 0) {
    console.error('━'.repeat(60))
    console.error('[memour] FATAL: missing required env vars:')
    for (const k of missingRequired) console.error(`  - ${k}`)
    console.error('Copy .env.example to .env and fill in your values.')
    console.error('━'.repeat(60))
    // We don't throw — let the app run so the operator sees the page
    // and Supabase's own errors. Throwing here would crash Nitro on
    // every deploy that forgot a single var.
    return
  }

  const missingRec = recommended.filter(k => !process.env[k])
  if (missingRec.length > 0) {
    console.warn(
      `[memour] WARN: missing recommended env vars: ${missingRec.join(', ')} `
      + `— SMS / Telegram features will degrade gracefully.`,
    )
  }

  const missingPay = paymentOptional.filter(k => !process.env[k])
  if (missingPay.length === paymentOptional.length) {
    console.warn('[memour] INFO: no payment provider configured — checkout runs in dev fallback mode.')
  }

  console.log('[memour] env check passed.')
})
