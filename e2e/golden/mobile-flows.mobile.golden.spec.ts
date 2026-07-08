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

test('the add sheet is a full-screen takeover that fits without scrolling and closes via ✕', async ({
  page,
}) => {
  await page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Add' }).tap()
  const sheet = page.getByRole('dialog', { name: 'Add a task' })
  await expect(sheet).toBeVisible()

  // Full-screen: the panel spans the whole viewport (100dvh × full width).
  const viewport = page.viewportSize()!
  const box = (await sheet.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1)
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1)

  // Fits: in BOTH modes everything is reachable with no scrolling — the sheet's scroll container
  // has no overflow, and the manual submit sits in-bounds at the bottom edge.
  // (e2e is typechecked without the DOM lib, so reach getComputedStyle via the element's document.)
  const noOverflow = () =>
    sheet.evaluate((el) => {
      const view = el.ownerDocument.defaultView!
      const scroller = [el, ...el.querySelectorAll('*')].find(
        (n) => view.getComputedStyle(n).overflowY === 'auto',
      )!
      return scroller.scrollHeight <= scroller.clientHeight
    })
  expect(await noOverflow()).toBe(true) // BabyClaw (default) mode
  await sheet.getByRole('button', { name: 'Manual' }).tap()
  expect(await noOverflow()).toBe(true) // Manual mode
  const submit = await sheet.getByRole('button', { name: 'Add task' }).boundingBox()
  expect(submit!.y + submit!.height).toBeLessThanOrEqual(viewport.height)

  // The header ✕ dismisses (the scrim is hidden behind a full-height panel, so ✕ is the way out).
  await sheet.getByRole('button', { name: 'Close' }).tap()
  await expect(sheet).toBeHidden()
})

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
