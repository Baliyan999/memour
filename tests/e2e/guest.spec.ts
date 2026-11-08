import { expect, test } from './harness/fixtures'
import { t } from './harness/messages'
import { joinAsGuest, sendPhoto } from './harness/pages'

test('a guest joins a Pro wedding and sends a photo', async ({ page, seed }) => {
  const event = await seed.event({ plan_tier: 'pro' })
  const guest = seed.name('Guest')

  await joinAsGuest(page, event.id, { name: guest, table: 3 })
  const res = await sendPhoto(page)
  expect(res.status()).toBe(200)

  // "Sent · 1/30" for a moment, then the counter on the photo tab stays at 1/30.
  await expect(page.getByText(t('uz', 'guest.camera.uploadedHeader', { count: '1/30' }))).toBeVisible({ timeout: 1_500 })
  await expect(page.getByRole('button', { name: t('uz', 'guest.camera.photoTab'), exact: true })).toContainText('1/30')

  const photos = await seed.db.select('photos', `select=storage_path,thumbnail_path,guest_name,guest_table,mime_type&event_id=eq.${event.id}`)
  expect(photos).toHaveLength(1)
  expect(photos[0]).toMatchObject({ guest_name: guest, guest_table: 3, mime_type: 'image/jpeg' })
  const stored = await seed.db.listObjects('photos', `${event.id}/`)
  expect(stored).toContain(photos[0]!.storage_path)

  const [device] = await seed.db.select('guest_devices', `select=table_number,photo_count&event_id=eq.${event.id}`)
  expect(device).toMatchObject({ table_number: 3, photo_count: 1 })
})
