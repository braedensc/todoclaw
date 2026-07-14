import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/fixtures'

// The feature tour runs in two legs: leg 1 spotlights the DemoScene — a filled example board, the
// canned plan, and the scripted morning/evening check-ins, all REAL components over fake in-memory
// data — then leg 2 walks the user's OWN shell (Add-a-task, Plan My Day, inbox, habits, settings).
// These specs guard the leg sequencing, the act-aware skip semantics (skipping the example advances
// to the real walkthrough; only closing leg 2 latches the checkmark), and the empty-board peek.

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

// Walk to the end of the current leg: click Next until the last step (where the primary button
// becomes Finish), then Finish. Resilient to how many shell anchors happen to be mounted — a step
// whose anchor is missing drops silently, so leg 2's length isn't hard-coded here.
async function finishRemaining(page: Page): Promise<void> {
  for (;;) {
    const next = page.getByRole('button', { name: 'Next', exact: true })
    if ((await next.count()) === 0) break
    await next.click()
  }
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
}

test('the tour walks the example day (leg 1) then the real shell (leg 2), latching done', async ({
  page,
}) => {
  await startTourFromGuide(page)

  // Leg 1 — the example day, unmistakably framed as an example over a lived-in board.
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

  // Leg 1's last-step button hands off to leg 2 over the user's OWN shell — the scene is gone. It
  // says where it goes ("Next: your app"), not a misleading "Finish".
  await page.getByRole('button', { name: 'Next: your app', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add tasks by just saying them' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()

  // The Plan My Day button the user asked to see is spotlighted in the real shell.
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your Plan My Day button' })).toBeVisible()

  // Nothing latched yet — leg 2 owns the checkmark.
  expect(await tourDone(page)).toBeNull()

  // Finishing leg 2 latches the guide's tour step.
  await finishRemaining(page)
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('skipping the example advances to the real walkthrough instead of swallowing it', async ({
  page,
}) => {
  await startTourFromGuide(page)

  // Leg 1's escape hatch says where it goes — and goes there.
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip to your app', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add tasks by just saying them' })).toBeVisible()
  expect(await tourDone(page)).toBeNull()

  // Skipping leg 2 latches done (a skipper shouldn't be nagged by an eternal unchecked box).
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('the empty grid offers an example peek that latches nothing', async ({ page }) => {
  // Guide stays dismissed (storageState) — this is the post-guide empty-board entry point.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()

  // The peek closes straight back to the shell — no leg 2, no latch.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  expect(await tourDone(page)).toBeNull()
})

test('Settings → Replay the tour re-runs both legs without resetting the guide', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Replay the tour', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  // The guide's dismissal is untouched (unlike "Show the setup guide", which resets it).
  expect(await page.evaluate((k) => localStorage.getItem(k), GUIDE_DISMISSED_KEY)).toBe('1')
})
