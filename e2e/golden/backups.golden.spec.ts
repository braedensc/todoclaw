import { test, expect } from '../helpers/fixtures'
import { placeTask } from '../helpers/ui'

// Golden path: snapshot the planner, add a task AFTER the snapshot, then restore — the
// post-snapshot task is soft-deleted (leaves the grid) while the snapshotted task stays. Proves
// the create_backup → restore_backup round-trip end-to-end against the real local stack, and the
// content-restore semantics (ADR-0023: soft-delete of items not in the snapshot; history kept).

test('create a backup, then restore it — a task added after the snapshot is removed', async ({
  page,
}) => {
  // Snapshot state: exactly one task on the grid.
  await placeTask(page, 'Keep me', 0.75, 0.25)

  await page.getByRole('button', { name: 'Backups' }).click()
  const dialog = page.getByRole('dialog', { name: 'Backups' })
  await expect(dialog.getByText('No backups yet — create one above.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create backup' }).click()
  // The snapshot appears with a Restore control.
  const restore = dialog.getByRole('button', { name: /Restore backup from/ })
  await expect(restore).toBeVisible()
  await dialog.getByRole('button', { name: 'Close backups' }).click()

  // Add a second task AFTER the snapshot — it is not part of it.
  await placeTask(page, 'Added later', 0.25, 0.75)
  await expect(page.getByTestId('grid-card')).toHaveCount(2)

  // Restore the snapshot (accept the confirm dialog fired by window.confirm).
  await page.getByRole('button', { name: 'Backups' }).click()
  page.once('dialog', (d) => void d.accept())
  await restore.click()
  await dialog.getByRole('button', { name: 'Close backups' }).click()

  // 'Keep me' (in the snapshot) survives; 'Added later' (post-snapshot) is soft-deleted → gone.
  await expect(page.getByTestId('grid-card').filter({ hasText: 'Keep me' })).toBeVisible()
  await expect(page.getByTestId('grid-card').filter({ hasText: 'Added later' })).toHaveCount(0)
  await expect(page.getByTestId('grid-card')).toHaveCount(1)
})
