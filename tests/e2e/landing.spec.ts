import { LEAD_CHAT_ID } from './harness/env'
import { expect, test } from './harness/fixtures'
import { t, type Locale } from './harness/messages'
import { toTelegramChat, waitForMock } from './harness/mock-log'
import { gotoHydrated } from './harness/pages'

for (const locale of ['uz', 'ru'] as Locale[]) {
  test(`landing renders in ${locale}`, async ({ page }) => {
    const res = await page.goto(`/${locale}`)
    expect(res?.status()).toBe(200)
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'uz' ? 'uz-UZ' : 'ru-RU')
    await expect(page.getByText(t(locale, 'hero.eyebrow')).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: t(locale, 'lead.title') })).toBeAttached()
    await expect(page.getByRole('button', { name: t(locale, 'lead.submit') })).toBeAttached()
    // A missing translation shows up as its key.
    expect(await page.locator('body').innerText()).not.toMatch(/\b(hero|lead|pricing|nav|footer|how|features)\.[a-z]\w*/)
  })
}

test('the lead form saves the lead and pings the team on Telegram', async ({ page, seed }) => {
  const name = seed.name('Lead')
  const phone = seed.phone()

  await gotoHydrated(page, '/uz')
  await page.locator('#name').fill(name)
  await page.locator('#phone').fill(phone)
  await page.locator('#lead-consent').check()
  await page.getByRole('button', { name: t('uz', 'lead.submit') }).click()
  await expect(page.getByText(t('uz', 'lead.successTitle'))).toBeVisible()

  const leads = await seed.db.select('leads', `select=id,phone,locale,source&name=eq.${encodeURIComponent(name)}`)
  expect(leads).toHaveLength(1)
  expect(leads[0]).toMatchObject({ phone: `+${phone.replace(/\D/g, '')}`, locale: 'uz', source: 'landing' })

  const shortId = String(leads[0]!.id).replace(/-/g, '').slice(0, 8)
  const alert = await waitForMock((m) => toTelegramChat(LEAD_CHAT_ID)(m) && !!m.text?.includes(`#${shortId}`))
  // The team chat gets a neutral ping: no name, no phone.
  expect(alert.text).not.toContain(name)
  expect(alert.text).not.toContain(phone.replace(/\D/g, '').slice(-7))
})
