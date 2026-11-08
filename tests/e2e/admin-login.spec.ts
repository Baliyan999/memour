import { expect, test } from './harness/fixtures'
import { t } from './harness/messages'
import { toTelegramChat, waitForMock } from './harness/mock-log'
import { gotoHydrated } from './harness/pages'

test('an admin logs in with password + Telegram code and sees the events list', async ({ page, seed }) => {
  const admin = await seed.admin()
  const event = await seed.event({ couple_names: seed.name('Admin view') })

  await gotoHydrated(page, '/uz/admin/login')
  await page.locator('#admin-email').fill(admin.email)
  await page.locator('#admin-password').fill(admin.password)
  await page.getByRole('button', { name: t('uz', 'admin.login.submit') }).click()
  await expect(page.getByText(t('uz', 'admin.login.titleCode'))).toBeVisible()

  // The 2FA code went to the admin's Telegram chat — here, the mock's log.
  const message = await waitForMock(toTelegramChat(admin.chatId))
  const code = /\b(\d{6})\b/.exec(message.text ?? '')?.[1]
  expect(code, 'no 6-digit code in the Telegram message').toBeTruthy()

  // Six one-digit boxes (maxlength=1), one digit each.
  const boxes = page.locator('input[inputmode="numeric"][maxlength="1"]')
  await expect(boxes).toHaveCount(6)
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code![i]!)
  await page.getByRole('button', { name: t('uz', 'admin.login.confirm') }).click()

  await expect(page).toHaveURL(/\/uz\/admin\/?$/)
  await expect(page.getByText(event.couple_names)).toBeVisible()
})
