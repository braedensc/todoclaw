import { test, expect } from '../helpers/fixtures'
import { openReminders } from '../helpers/ui'

// Golden path (post habits-setup redesign): the Daily habits page is a SETUP surface — you add
// habits and their OPTIONAL details there, but you do NOT tick them off there (management only).
// Habits are checked off from the HOME screen's inline list. So: add a habit + a detail on the
// setup page, return home, check it off, open its detail popup to see the check cascade to the
// detail, then reload to prove it persisted to daily_state (checks reset each local day by reading
// a fresh date-keyed row, so "checked" must survive a reload within the same day).
const HABIT = 'Morning stretch'
const DETAIL = 'Neck rolls'

test('set up a habit + detail, check it off from home; checks survive a reload', async ({
  page,
}) => {
  // 1) SETUP page — add the habit and one optional detail. No daily checkboxes live here.
  await openReminders(page)
  const habitsSection = page.getByRole('region', { name: 'Daily habits' })

  await habitsSection.getByPlaceholder('Add a habit…').fill(HABIT)
  await habitsSection.getByRole('button', { name: 'Add habit' }).click()

  const row = habitsSection.getByRole('listitem').filter({ hasText: HABIT })
  await expect(row).toBeVisible()
  // The setup page never shows a daily check — that only lives on home.
  await expect(row.getByRole('checkbox')).toHaveCount(0)

  // Open the details panel: the "optional" hint shows until there's a detail. Then add one.
  await row.getByRole('button', { name: `Show details for "${HABIT}"` }).click()
  await expect(row.getByText(/Details are optional/i)).toBeVisible()
  await row.getByLabel(`Add a detail to "${HABIT}"`).fill(DETAIL)
  await row.getByRole('button', { name: /Add detail/ }).click()
  await expect(row.getByText(DETAIL)).toBeVisible()

  // 2) Back to HOME (the ✕ → browser Back). The setup region goes away.
  await page.getByRole('button', { name: 'Close habits' }).click()
  await expect(page.getByRole('region', { name: 'Daily habits' })).toHaveCount(0)

  // 3) Check the habit off from the inline home list — the ONLY place habits get ticked. click()
  // rather than a checkbox assertion: the toggle is CONTROLLED, flipping only once the daily_state
  // write + refetch land, so aria-pressed retries until it flips.
  const habitToggle = page.getByRole('button', { name: `Mark habit "${HABIT}" done today` })
  await expect(habitToggle).toBeVisible()
  await expect(habitToggle).toHaveAttribute('aria-pressed', 'false')
  await habitToggle.click()
  await expect(habitToggle).toHaveAttribute('aria-pressed', 'true')

  // 4) Open the detail popup from home (the name button, exact — the toggle's label also contains
  // the habit text). Checking the habit is a master switch, so the detail reads as checked too.
  await page.getByRole('button', { name: HABIT, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Habit: ${HABIT}` })
  await expect(
    dialog.getByRole('checkbox', { name: `Mark detail "${DETAIL}" done today` }),
  ).toBeChecked()
  await dialog.getByRole('button', { name: 'Close habit' }).click()

  // 5) Reload: today's daily_state row still holds the check — proves the write landed server-side,
  // not just in component state.
  await page.reload()
  await expect(
    page.getByRole('button', { name: `Mark habit "${HABIT}" done today` }),
  ).toHaveAttribute('aria-pressed', 'true')
})
