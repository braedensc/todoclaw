import type { Page } from '@playwright/test'
import { test, expect } from '../helpers/fixtures'

// The two-act feature tour: Act 1 spotlights the DemoScene — a filled example board, the canned
// plan, and the scripted morning/evening check-ins, all REAL components over fake in-memory data
// — then Act 2 walks the user's own (empty) shell. These specs guard the act sequencing, the
// act-aware skip semantics (skipping the example advances to the real tour; only closing Act 2
// latches the checkmark), and the empty-board "See an example board" peek.

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

test('the full tour: example day (Act 1) → own shell (Act 2) → latched done', async ({ page }) => {
  await startTourFromGuide(page)

  // Act 1 — the demo scene, unmistakably framed as an example, showing a lived-in board.
  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  // Walk the four demo steps: board → plan → morning check-in → evening check-in.
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'One tap plans the day' })).toBeVisible()
  await expect(
    page.getByText('Invoice first — then three quick wins to clear the deck.', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'The plan comes to you' })).toBeVisible()
  await expect(page.getByText(/Good morning!/)).toBeVisible()

  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Evenings close the loop' })).toBeVisible()
  await expect(page.getByText(/Which of these did you knock out today\?/)).toBeVisible()

  // Finishing Act 1 hands off to Act 2 over the user's OWN empty shell — the scene is gone. The
  // last-step button says where it goes ("Next: your board"), not a misleading "Finish".
  await page.getByRole('button', { name: 'Next: your board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'This board is yours' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  await expect(page.getByText('No tasks placed — add one above and drag it here.')).toBeVisible()

  // Nothing latched yet — Act 2 owns the checkmark.
  expect(await tourDone(page)).toBeNull()

  // Walk Act 2 (5 desktop steps) to the end; finishing latches the guide's tour step.
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Finish', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('skipping the example advances to the real tour instead of swallowing it', async ({
  page,
}) => {
  await startTourFromGuide(page)

  // The demo act's escape hatch says where it goes — and goes there.
  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip to your board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'This board is yours' })).toBeVisible()
  expect(await tourDone(page)).toBeNull()

  // Skipping Act 2 latches done (a skipper shouldn't be nagged by an eternal unchecked box).
  await page.getByRole('button', { name: 'Skip tour', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await tourDone(page)).toBe('1')
})

test('the empty grid offers an example peek that latches nothing', async ({ page }) => {
  // Guide stays dismissed (storageState) — this is the post-guide empty-board entry point.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()

  // The peek closes straight back to the shell — no Act 2, no latch.
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).not.toBeVisible()
  expect(await tourDone(page)).toBeNull()
})

test('Settings → Replay the tour re-runs both acts without resetting the guide', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Replay the tour', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  // The guide's dismissal is untouched (unlike "Show the setup guide", which resets it).
  expect(await page.evaluate((k) => localStorage.getItem(k), GUIDE_DISMISSED_KEY)).toBe('1')
})
