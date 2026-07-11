import { test, expect } from '../helpers/fixtures'
import { placeTask, switchTab, expandRow } from '../helpers/ui'

// Recurring reminders end-to-end (the fixed-cadence alarm). A recurring task can carry ONE
// time-of-day reminder that fires on its cadence, regardless of completion. This drives the full
// round-trip through the real DB: make the task recurring, set "Remind me at Noon" (set_recurring_
// reminder RPC → a task_reminders row with time_of_day), reload to prove it persisted (the
// useRecurringReminder query reads it back), then turn it Off (remove_recurring_reminder deletes
// the row). No raw SQL — the RLS-scoped RPCs only.
const TASK = 'Take pill'

test('a recurring task gets a time-of-day reminder; it persists and can be cleared', async ({
  page,
}) => {
  await placeTask(page, TASK, 0.55, 0.45)

  // Make it recurring (Daily) from the expanded list row, which reveals the "Remind me at" control.
  await switchTab(page, 'List')
  const row = page.getByRole('listitem').filter({ hasText: TASK })
  await expandRow(row)
  // exact: the row-expand button's accessible name ('Rank 1 Take pill') would substring-match.
  await row.getByRole('button', { name: 'Daily', exact: true }).click()

  // Set the fixed-cadence alarm to Noon → persists a task_reminders row via set_recurring_reminder.
  const picker = page.getByTestId('recurring-reminder-list')
  await picker.getByRole('button', { name: 'Noon' }).click()
  await expect(picker.getByRole('button', { name: 'Noon' })).toHaveAttribute('aria-pressed', 'true')

  // Round-trip through the DB: reload, re-open the row, and the reminder reads back as Noon.
  await page.reload()
  await switchTab(page, 'List')
  const row2 = page.getByRole('listitem').filter({ hasText: TASK })
  await expandRow(row2)
  const picker2 = page.getByTestId('recurring-reminder-list')
  await expect(picker2.getByRole('button', { name: 'Noon' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Off deletes the row; the picker reflects it (reads from the refetched query).
  await picker2.getByRole('button', { name: 'Off' }).click()
  await expect(picker2.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker2.getByRole('button', { name: 'Noon' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
