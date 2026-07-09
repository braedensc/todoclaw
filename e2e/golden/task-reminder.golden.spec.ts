import { test, expect } from '../helpers/fixtures'
import { selectManualMode, switchTab, expandRow } from '../helpers/ui'

// Per-task reminders end-to-end (PR 5 UI over the PR 4 backend). Adding a task with a due TIME
// pre-selects the 1-hour default reminder and persists a task_reminders row; the list editor
// reads it back and can turn it off — a full round-trip through the real DB (RLS-scoped upsert +
// delete + the reminders query), no raw SQL. UTC-pinned suite → tomorrow is unambiguous.

test('a timed task gets the default reminder; the editor reads it back and can clear it', async ({
  page,
}) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  await selectManualMode(page)
  await page.getByLabel('Add a task').fill('Team meeting')
  await page.getByRole('button', { name: 'Due' }).click()
  await page.getByLabel('Due date').fill(tomorrow)
  await page.getByLabel('Due time').fill('15:00')

  // The default (1 hour before) is pre-selected the moment a time exists.
  const addPicker = page.getByTestId('reminder-picker-add')
  await expect(addPicker.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // Round-trip: the reminder persisted → the list row's editor shows 1 hour selected.
  await switchTab(page, 'List')
  const row = page.getByRole('listitem').filter({ hasText: 'Team meeting' })
  await expandRow(row)
  const listPicker = page.getByTestId('reminder-picker-list')
  await expect(listPicker.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Turning it Off deletes the row; the picker reflects it (reads from the refetched query).
  await listPicker.getByRole('button', { name: 'Off' }).click()
  await expect(listPicker.getByRole('button', { name: 'Off' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(listPicker.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
