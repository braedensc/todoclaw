import { test, expect } from '../helpers/fixtures'
import { placeTask, switchTab, openDone, expandRow } from '../helpers/ui'

// Golden path: make a task recurring, then mark it done — a cycle-done RESETS the clock
// (lastDoneAt = now → status "ok") instead of archiving: the task stays in the list, leaves
// the grid only until the next cycle, and writes NO history row (parity spec: recurring done
// lives in lastDoneAt; the Done tab is only for one-off completions).
const TASK = 'Weekly review'

test('set recurring → cycle-done resets the clock instead of archiving', async ({ page }) => {
  await placeTask(page, TASK, 0.55, 0.45)

  // Make it recurring from the expanded list row's SchedulePanel: the Weekly preset (= 7 days).
  await switchTab(page, 'List')
  const row = page.getByRole('listitem').filter({ hasText: TASK })
  await expandRow(row)
  // exact: the row-expand button's accessible name ('Rank 1 Weekly review') would substring-match.
  await row.getByRole('button', { name: 'Weekly', exact: true }).click()

  // A never-completed recurring task reads as overdue ("never done"), with the cadence
  // formatted (7 → "weekly") and the done control now labelled as a clock reset.
  await expect(row.getByLabel('Recurring, never done')).toBeVisible()
  await expect(row).toContainText('weekly')
  const cycleDone = row.getByRole('button', { name: 'Mark done (resets clock)' })
  await expect(cycleDone).toBeVisible()

  // Cycle-done: lastDoneAt = now → daysLeft = 7 → status "in 7d" (ok). The row STAYS in the
  // list — it was not archived.
  await cycleDone.click()
  await expect(row.getByLabel('Recurring, in 7d')).toBeVisible()
  await expect(row).toBeVisible()

  // An "ok" recurring task hides from the grid until the next cycle. Assert the EMPTY STATE
  // too — count(0) alone would also pass on a query error / crashed grid, this proves the
  // grid rendered and is genuinely empty.
  await switchTab(page, 'Grid')
  await expect(page.getByText('No tasks placed — add one above and drag it here.')).toBeVisible()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // …and recurring completions never reach the permanent history. (Empty-state copy tracks
  // DoneView — updated by the dog-theme pass in #185.)
  await openDone(page)
  await expect(
    page.getByText('Nothing done yet — the pup’s still waiting for his first trick.'),
  ).toBeVisible()
})
