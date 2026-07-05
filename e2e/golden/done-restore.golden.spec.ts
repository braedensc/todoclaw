import { test, expect } from '../helpers/fixtures'
import { placeTask, openDone, closeDone } from '../helpers/ui'

// Golden path: mark a placed task done from the grid → it leaves the grid and appears in the
// Done tab (history row with a timestamp) → Restore (offered for any completion whose task is
// still live) puts it back on the grid; the history row stays until ✕ removes it from the list.
const TASK = 'Return library books'

test('mark done → Done tab shows the completion → restore returns it to the grid → ✕ removes the record', async ({
  page,
}) => {
  const card = await placeTask(page, TASK, 0.75, 0.25)

  // The card's action controls reveal on hover; the "Mark done" button archives a non-recurring
  // task (a recurring card's control is "Mark done (resets clock)", so exact avoids it).
  await card.hover()
  await card.getByRole('button', { name: 'Mark done', exact: true }).click()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Done panel: the completion is listed with its timestamp and a Restore control (its task is
  // still live). Scope to the Done region — the header link is also named "Done".
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  const row = doneSection.getByRole('listitem').filter({ hasText: TASK })
  await expect(row).toBeVisible()
  await expect(row).toHaveText(/at \d{1,2}:\d{2}/) // "Jul 1 at 10:45 PM" (locale pinned en-US)

  // Restore un-marks it done for today; the history row stays (delete is a separate action), so
  // its Restore control persists (the task is still live).
  await row.getByRole('button', { name: `Restore "${TASK}"` }).click()
  await expect(row).toBeVisible()

  // Back on the grid, the task is live again at its old spot.
  await closeDone(page)
  await expect(page.getByTestId('grid-card').filter({ hasText: TASK })).toBeVisible()

  // ✕ removes the completion RECORD from the history list (after the confirm dialog).
  await openDone(page)
  await doneSection
    .getByRole('listitem')
    .filter({ hasText: TASK })
    .getByRole('button', { name: `Delete "${TASK}"` })
    .click()
  // The confirm dialog is a portal (its own role="dialog"); scope by its title to avoid the
  // Done panel dialog, then click its Delete button.
  await page
    .getByRole('dialog', { name: /from your history/ })
    .getByRole('button', { name: /^Delete$/ })
    .click()
  await expect(doneSection.getByRole('listitem').filter({ hasText: TASK })).toHaveCount(0)
})
