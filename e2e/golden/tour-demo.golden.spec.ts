import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/fixtures'

// The feature tour is ONE section, played entirely over the DemoScene — a filled example board, the
// canned plan, and the scripted morning/evening check-ins, all REAL components over fake in-memory
// data. These specs guard the walkthrough, the "finishing OR skipping latches the checkmark"
// semantics, and the empty-board "See an example board" peek (which latches nothing).

const TOUR_DONE_KEY = 'todoclaw.setup-guide.tour-done'
const GUIDE_DISMISSED_KEY = 'todoclaw.setup-guide.dismissed'

// The auth setup pre-dismisses the first-run guide for every golden spec (storageState); these
// specs are ABOUT the first-run flow, so un-dismiss and reload to get the real entry point back.
async function startTourFromGuide(page: Page): Promise<void> {
  await page.evaluate((k) => localStorage.removeItem(k), GUIDE_DISMISSED_KEY)
  await page.reload()
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()
}

const tourDone = (page: Page) => page.evaluate((k) => localStorage.getItem(k), TOUR_DONE_KEY)

test('the tour walks the example day, then latches done', async ({ page }) => {
  await startTourFromGuide(page)

  // Opens with a plain-words welcome, unmistakably framed as an example over a lived-in board.
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  // Walk the six demo steps: welcome → board → task kinds → plan → morning → evening.
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Sorted by what matters' })).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Three kinds of task' })).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'One tap plans your day' })).toBeVisible()
  await expect(
    page.getByText('Invoice first — then three quick wins to clear the deck.', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'The plan comes to you' })).toBeVisible()
  await expect(page.getByText(/Good morning!/)).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Evenings close the loop' })).toBeVisible()
  await expect(page.getByText(/Which of these did you knock out today\?/)).toBeVisible()

  // Not latched until the tour actually closes.
  expect(await tourDone(page)).toBeNull()

  // Finishing closes the tour, tears down the scene, and latches the guide's tour step.
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('skipping the tour also latches done (no eternal unchecked box)', async ({ page }) => {
  await startTourFromGuide(page)

  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('the empty grid offers an example peek that latches nothing', async ({ page }) => {
  // Guide stays dismissed (storageState) — this is the post-guide empty-board entry point.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()

  // The peek closes straight back to the shell — no latch.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  expect(await tourDone(page)).toBeNull()
})

test('Settings → Replay the tour re-runs it without resetting the guide', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Replay the tour', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  // The guide's dismissal is untouched (unlike "Show the setup guide", which resets it).
  expect(await page.evaluate((k) => localStorage.getItem(k), GUIDE_DISMISSED_KEY)).toBe('1')
})
