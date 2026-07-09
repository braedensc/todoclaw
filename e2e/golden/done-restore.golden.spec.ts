import { test, expect } from '../helpers/fixtures'
import { placeTask, openDone, closeDone } from '../helpers/ui'

// Golden path for the Done surface (a centered popup on desktop / bottom sheet on mobile, over the
// still-mounted home): mark a placed task done from the grid → it leaves the grid and appears in
// Done as a history row with a timestamp → Restore returns it to the grid, and Delete (×) drops a
// record from the list.
//
// Two behaviours, two tests, because Restore now ALSO removes the row (restore-removes-from-list —
// DoneView fires deleteEntry on restore success), so a single completion can't exercise both.

test('mark done → Done shows the completion → restore returns it to the grid and off the list', async ({
  page,
}) => {
  const TASK = 'Return library books'
  const card = await placeTask(page, TASK, 0.75, 0.25)

  // The card's action controls reveal on hover; the "Mark done" button archives a non-recurring
  // task (a recurring card's control is "Mark done (resets clock)", so exact avoids it).
  await card.hover()
  await card.getByRole('button', { name: 'Mark done', exact: true }).click()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Done page: the completion is listed with its timestamp and a Restore control (its task is
  // still live). Scope to the Done region — the header/nav link is also named "Done".
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  const row = doneSection.getByRole('listitem').filter({ hasText: TASK })
  await expect(row).toBeVisible()
  await expect(row).toHaveText(/at \d{1,2}:\d{2}/) // "Jul 1 at 10:45 PM" (locale pinned en-US)

  // Restore un-marks it done for today AND drops the history row (restore-removes-from-list).
  await row.getByRole('button', { name: `Restore "${TASK}"` }).click()
  await expect(doneSection.getByRole('listitem').filter({ hasText: TASK })).toHaveCount(0)

  // Back on the grid, the task is live again at its old spot.
  await closeDone(page)
  await expect(page.getByTestId('grid-card').filter({ hasText: TASK })).toBeVisible()
})

test('Done → ✕ removes a completion record from the list', async ({ page }) => {
  const TASK = 'File the expense report'
  const card = await placeTask(page, TASK, 0.75, 0.25)

  await card.hover()
  await card.getByRole('button', { name: 'Mark done', exact: true }).click()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(doneSection.getByRole('listitem').filter({ hasText: TASK })).toBeVisible()

  // ✕ removes the completion RECORD from the list (after the confirm dialog).
  await doneSection
    .getByRole('listitem')
    .filter({ hasText: TASK })
    .getByRole('button', { name: `Delete "${TASK}"` })
    .click()
  // The confirm dialog is a portal with its own role="dialog"; scope by its title before clicking
  // its Delete (the Done surface is a region now, not a dialog, so there's just this one).
  await page
    .getByRole('dialog', { name: /from your history/ })
    .getByRole('button', { name: /^Delete$/ })
    .click()
  await expect(doneSection.getByRole('listitem').filter({ hasText: TASK })).toHaveCount(0)
})
