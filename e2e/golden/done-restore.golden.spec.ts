import { test, expect } from '../helpers/fixtures'
import { placeTask, switchTab } from '../helpers/ui'

// Golden path: mark a placed task done from the grid → it leaves the grid and appears in the
// Done tab (permanent history row with a timestamp) → Restore (offered while the completion is
// still in TODAY's daily_state.done) puts it back on the grid; the history row itself is
// permanent and survives the restore (ADR-0012).
const TASK = 'Return library books'

test('mark done → Done tab shows the completion → restore returns it to the grid', async ({
  page,
}) => {
  const card = await placeTask(page, TASK, 0.75, 0.25)

  // The card's action buttons reveal on hover; "Done" archives a non-recurring task.
  await card.hover()
  await card.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Done tab: the completion is listed with its timestamp and a Restore control (it is still
  // in today's done map). Scope to the Done section — the tab button is also named "Done".
  await switchTab(page, 'Done')
  const doneSection = page.getByRole('region', { name: 'Done' })
  const row = doneSection.getByRole('listitem').filter({ hasText: TASK })
  await expect(row).toBeVisible()
  await expect(row).toHaveText(/at \d{1,2}:\d{2}/) // "Jul 1 at 10:45 PM" (locale pinned en-US)

  // Restore flips today's done flag; the row itself is permanent, so it stays — only the
  // Restore control disappears (no longer done today).
  await row.getByRole('button', { name: `Restore "${TASK}"` }).click()
  await expect(row.getByRole('button', { name: `Restore "${TASK}"` })).toHaveCount(0)
  await expect(row).toBeVisible()

  // Back on the grid, the task is live again at its old spot.
  await switchTab(page, 'Grid')
  await expect(page.getByTestId('grid-card').filter({ hasText: TASK })).toBeVisible()
})
