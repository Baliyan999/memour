/**
 * Page steps shared by several specs.
 */
import { join } from 'node:path'
import type { Page, Response } from '@playwright/test'
import { expect } from '@playwright/test'
import { ROOT } from './env'
import { t, type Locale } from './messages'

export const PHOTO_FIXTURE = join(ROOT, 'tests', 'e2e', 'fixtures', 'photo.jpg')

/**
 * Open a page and wait until Vue has hydrated it. Typing into the
 * server-rendered HTML before that is lost (v-model isn't bound yet) and
 * a form would submit natively.
 */
export async function gotoHydrated(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForFunction(() => (window as unknown as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp?.().isHydrating === false)
}

/**
 * A guest scans the table QR (/<locale>/e/<id>?t=<table>), types a name,
 * ticks both consent boxes and opens the camera.
 *
 * Headless browsers have no camera: getUserMedia is made to refuse, so
 * the page offers its file-input fallback (the one in-app browsers and
 * denied permissions get) and the test can send a fixture photo.
 */
export async function joinAsGuest(page: Page, eventId: string, opts: { name: string; table?: number; locale?: Locale }): Promise<void> {
  const locale = opts.locale ?? 'uz'
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('e2e: no camera', 'NotAllowedError'))
    }
  })
  await gotoHydrated(page, `/${locale}/e/${eventId}?t=${opts.table ?? 3}`)
  await page.getByPlaceholder(t(locale, 'guest.welcome.namePlaceholder')).fill(opts.name)
  await page.locator('#guest-rules').check()
  await page.locator('#guest-privacy').check()
  await page.getByRole('button', { name: t(locale, 'guest.welcome.openCamera') }).click()
  await page.getByRole('button', { name: t(locale, 'guest.camera.openCamera') }).click()
  await expect(page.getByText(t(locale, 'guest.camera.useSystemCamera'))).toBeVisible()
}

/** Pick the fixture photo, press "send", and return the upload's response. */
export async function sendPhoto(page: Page, locale: Locale = 'uz'): Promise<Response> {
  await page.locator('input[type="file"]').setInputFiles(PHOTO_FIXTURE)
  const send = page.getByRole('button', { name: t(locale, 'guest.aria.send') })
  await expect(send).toBeVisible()
  // GuestCamera ignores "send" for 450 ms after a frame appears
  // (REVIEW_ARM_MS: a double tap must not send the frame unseen).
  await page.waitForTimeout(600)
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/guest/upload' && r.request().method() === 'POST')
  await send.click()
  return response
}
