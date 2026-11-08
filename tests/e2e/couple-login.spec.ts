import { expect, test } from './harness/fixtures'
import { verifyLink, waitForMail } from './harness/mailbox'
import { t } from './harness/messages'
import { gotoHydrated } from './harness/pages'

test('a couple logs in with the email link and sees their wedding', async ({ page, seed }) => {
  const email = seed.email('couple')
  const user = await seed.user(email)
  const event = await seed.event({ owner_id: user.id, couple_names: seed.name('Malika & Javohir') })

  await gotoHydrated(page, '/uz/dashboard/login')
  await page.getByRole('button', { name: t('uz', 'couple.channelEmail') }).click()
  await page.locator('#login-email').fill(email)
  await page.locator('#login-terms-email').check()
  await page.locator('#login-privacy-email').check()
  await page.getByRole('button', { name: t('uz', 'couple.sendMagicLink') }).click()
  await expect(page.getByText(t('uz', 'couple.emailCheckInbox'))).toBeVisible()

  const mail = await waitForMail(email)
  seed.trackMail(mail.id)

  // Opening the link: GoTrue checks the token and redirects with a
  // one-time ?code= to the redirect URL its allow-list accepts (the
  // stack's site_url when this port isn't listed). The code is what the
  // app needs; it reaches the app in the browser that asked for the
  // link, whose cookie holds the PKCE verifier — as a real redirect would.
  const verify = await fetch(verifyLink(mail), { redirect: 'manual' })
  const location = verify.headers.get('location') ?? ''
  const code = location ? new URL(location).searchParams.get('code') : null
  expect(code, `no ?code= in GoTrue's redirect (status ${verify.status}, ${location.split('?')[0]})`).toBeTruthy()

  await page.goto(`/uz/dashboard?code=${encodeURIComponent(code!)}`)
  // The server swaps the code for a session and drops it from the URL.
  await expect(page).toHaveURL(/\/uz\/dashboard$/)
  await expect(page.getByRole('heading', { name: t('uz', 'couple.dashboardTitle') })).toBeVisible()
  await expect(page.getByText(event.couple_names)).toBeVisible()
})
