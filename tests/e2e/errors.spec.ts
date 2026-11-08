import type { Page } from '@playwright/test'
import { expect, test } from './harness/fixtures'
import { t } from './harness/messages'
import { gotoHydrated, joinAsGuest, sendPhoto } from './harness/pages'

/** CLAUDE.md rule 2: no server code, HTTP status text or raw message on screen. */
async function expectNoRawServerText(page: Page, code: string): Promise<void> {
  const text = await page.locator('body').innerText()
  for (const raw of [code, 'statusCode', 'Forbidden', 'Unprocessable', 'Bad Request', 'Internal Server Error', 'ZodError', 'Network error']) {
    expect(text, `raw "${raw}" on the page`).not.toContain(raw)
  }
}

test('an upload refused by the server is explained in the site language', async ({ page, seed }) => {
  const event = await seed.event()
  await joinAsGuest(page, event.id, { name: seed.name('Guest') })

  // The wedding goes back to draft while the guest's camera is open.
  await seed.db.update('events', `id=eq.${event.id}`, { status: 'draft' })
  const res = await sendPhoto(page)
  expect(res.status()).toBe(403)
  expect((await res.json()).data.code).toBe('event_not_active')

  // The page reloads the event and shows its draft card, from i18n.
  await expect(page.getByRole('heading', { name: t('uz', 'guest.state.draftTitle') })).toBeVisible()
  await expect(page.getByText(t('uz', 'guest.state.draftDesc'))).toBeVisible()
  await expectNoRawServerText(page, 'event_not_active')
  expect(await seed.db.select('photos', `select=id&event_id=eq.${event.id}`)).toHaveLength(0)
})

test('a lead the server refuses shows the field error from i18n', async ({ page, seed }) => {
  const name = seed.name('Lead')
  await gotoHydrated(page, '/uz')
  await page.locator('#name').fill(name)
  await page.locator('#phone').fill(seed.phone())
  await page.locator('#lead-consent').check()

  // A number the form itself never sends (it checks for nine digits):
  // the server refuses it, and the visitor must read errors.invalid_phone
  // under the field, not the server's answer.
  await page.route('**/api/lead', async (route) => {
    await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), phone: '+998 12' }) })
  })
  const answer = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/lead')
  await page.getByRole('button', { name: t('uz', 'lead.submit') }).click()
  const res = await answer
  expect(res.status()).toBe(422)
  expect((await res.json()).data).toMatchObject({ code: 'invalid_phone' })

  await expect(page.locator('#phone-error')).toHaveText(t('uz', 'errors.invalid_phone'))
  await expect(page.getByText(t('uz', 'lead.successTitle'))).toHaveCount(0)
  await expectNoRawServerText(page, 'invalid_phone')
  expect(await seed.db.select('leads', `select=id&name=eq.${encodeURIComponent(name)}`)).toHaveLength(0)
})
