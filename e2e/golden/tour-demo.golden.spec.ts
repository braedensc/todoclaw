import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/fixtures'

// The feature tour is ONE section (8 panels). DemoScene mounts INLINE in the real shell — below the
// real header/mascot, in place of the real board/plan/reminders it stands in for — so the chrome
// around it (masthead, Account nav, mobile bottom bar) is always the real thing, never a look-alike.
// Only the plan panel (`demo-plan`) is look-only scenery, since a first-run user has no real plan
// yet. These specs guard the walkthrough, the "finishing OR skipping latches the checkmark"
// semantics, and the empty-board "See an example board" peek.
//
// Asserting demo chrome: scope look-only content to its `[data-tour="demo-*"]` anchor rather than a
// bare getByText/getByTitle where the copy could plausibly collide with real content elsewhere on
// the page. (getByRole is safe on its own: the scene is aria-hidden.)

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

  // Opens with a plain-words welcome over a lived-in example board; the real header/mascot stay
  // visible above it the whole time (DemoScene mounts inline, not as a covering overlay).
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /TodoClaw/ })).toBeVisible()
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
  // real header's own Plan My Day button, which stays visible and real throughout the tour.)
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
  // Desktop: the options chrome IS the real header's Account nav — no copy.
  await expect(page.locator('[data-tour="options"]').getByText('Daily habits')).toBeVisible()

  // Not latched until the tour actually closes.
  expect(await tourDone(page)).toBeNull()

  // Finishing closes the tour, tears down the scene, and latches the guide's tour step. Scoped to
  // the tour card: the real header's "✓ Done" button carries the same accessible name.
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Clean out the garage')).not.toBeVisible()
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
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  // The peek closes straight back to the shell — no latch.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText('Clean out the garage')).not.toBeVisible()
  expect(await tourDone(page)).toBeNull()
})

test('Settings → Replay the tour re-runs it without resetting the guide', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Replay the tour', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  // The guide's dismissal is untouched (unlike "Show the setup guide", which resets it).
  expect(await page.evaluate((k) => localStorage.getItem(k), GUIDE_DISMISSED_KEY)).toBe('1')
})
