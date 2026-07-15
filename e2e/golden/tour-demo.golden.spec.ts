import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/fixtures'

// The feature tour is ONE section (8 panels), played entirely over the DemoScene — a filled example
// board, the plan (+ its Plan My Day button), the scripted morning/evening check-ins, the real
// habits strip, and a look-only copy of the options chrome, all on the one scene. These specs guard
// the walkthrough, the "finishing OR skipping latches the checkmark" semantics, and the empty-board
// "See an example board" peek.
//
// Asserting demo chrome: ALWAYS scope to its `[data-tour="demo-*"]` anchor, never a bare getByText
// /getByTitle. The scene deliberately mirrors real controls (Plan My Day, the Account nav's Chat /
// Daily habits / Settings / Done), and the real ones are sitting right behind the overlay — an
// unscoped query matches both. (getByRole is safe on its own: the scene is aria-hidden.)

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
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  // Walk all eight panels: welcome → board → task kinds → plan → morning → evening → habits →
  // settings, every one spotlighting an element on the single example scene.
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Sorted by what matters' })).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Three kinds of task' })).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'One tap plans your day' })).toBeVisible()
  // The plan panel shows the plan the example ✦ button builds. (The button itself is aria-hidden
  // scenery — its render is covered by DemoScene.test.tsx; asserting it here would collide with the
  // real header's Plan My Day button sitting behind the overlay.)
  await expect(
    page.getByText('Invoice first — then three quick wins to clear the deck.', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'The plan comes to you' })).toBeVisible()
  await expect(page.getByText(/Good morning!/)).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Evenings close the loop' })).toBeVisible()
  await expect(page.getByText(/Which of these did you knock out today\?/)).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Daily habits' })).toBeVisible()
  // The habits panel points at the REAL RemindersInline strip, seeded from the sealed cache and
  // sitting right above the board — exactly where it lives in the real shell.
  await expect(
    page.locator('[data-tour="demo-habits"]').getByText('Stretch 10 minutes'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'The rest of the app' })).toBeVisible()
  // Desktop: the options chrome is a copy of the header's Account nav, along the top.
  await expect(page.locator('[data-tour="demo-options"]').getByText('Daily habits')).toBeVisible()

  // Not latched until the tour actually closes.
  expect(await tourDone(page)).toBeNull()

  // Finishing closes the tour, tears down the scene, and latches the guide's tour step. Scoped to
  // the tour card: the real header's "✓ Done" button carries the same accessible name.
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('skipping the tour also latches done (no eternal unchecked box)', async ({ page }) => {
  await startTourFromGuide(page)

  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('the empty grid offers an example peek that latches nothing', async ({ page }) => {
  // Guide stays dismissed (storageState) — this is the post-guide empty-board entry point.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
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
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  // The guide's dismissal is untouched (unlike "Show the setup guide", which resets it).
  expect(await page.evaluate((k) => localStorage.getItem(k), GUIDE_DISMISSED_KEY)).toBe('1')
})
