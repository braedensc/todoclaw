import { test, expect } from '../helpers/fixtures'
import { openDone } from '../helpers/ui'
import type { Page } from '@playwright/test'

// Mobile golden path (ADR-0028). Runs in the `chromium-mobile` project (Pixel 7 viewport + touch),
// so `useIsMobile` (< 720px) is true. On mobile there is NO grid and NO Grid/List toggle:
// MobileMatrix (the quadrant overview→focus list) is the only task surface, and ADDING happens via
// the bottom nav's "+" → MobileAddSheet (BabyClaw / Manual toggle). The Manual path drops a PLACED
// task at the chosen quadrant's center. The per-test DB wipe (fixtures) keeps these independent.
//
// NOTE: rewritten from the retired tap-to-place flow when the mobile grid was removed. Run the full
// golden suite locally to confirm selectors before merge.

// Add a task through the bottom-nav "+" sheet in Manual mode, into a given quadrant.
async function addManual(page: Page, text: string, quadrant: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Add' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Add a task' })
  await sheet.getByRole('button', { name: 'Manual' }).tap()
  await sheet.getByLabel('Task text').fill(text)
  await sheet.getByRole('button', { name: quadrant }).tap()
  await sheet.getByRole('button', { name: 'Add task' }).tap()
  await expect(sheet).toBeHidden()
}

test('add via the bottom-nav "+" (manual → quadrant) and the task lands in that quadrant', async ({
  page,
}) => {
  await addManual(page, 'Book the dentist', 'Do Now')

  // The Do Now overview cell now counts it; drill in and confirm it's a row.
  await page.getByRole('button', { name: /Do Now, \d+ task/ }).tap()
  await expect(page.getByRole('button', { name: /Book the dentist/ })).toBeVisible()
})

test('completing a task from the focus list flows through to the Done panel', async ({ page }) => {
  await addManual(page, 'Water the plants', 'Do Now')

  await page.getByRole('button', { name: /Do Now, \d+ task/ }).tap()
  const row = page.getByRole('listitem').filter({ hasText: 'Water the plants' })
  await row.getByRole('button', { name: 'Mark done', exact: true }).tap()

  // Open the Done panel from the bottom nav; the completion is listed there.
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Water the plants' }),
  ).toBeVisible()
})
