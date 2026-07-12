import { test, expect } from '../helpers/fixtures'
import { placeTask, switchTab, expandRow } from '../helpers/ui'

// Recurring reminders end-to-end — UNIFIED onto the offset model (2026-07-12). A recurring task's
// reminder is now the SAME lead-time offset as a one-off, only it leads each occurrence (anchored
// to the task's due date + time) and re-arms every cycle server-side. This drives the full
// round-trip through the real DB: make the task recurring + give it a due date + time, set "1 hour"
// before (set_task_reminder → a task_reminders row with offset_minutes, now ALLOWED on a recurring
// task), reload to prove it persisted (useTaskReminders reads it back), then turn it Off
// (clear_task_reminder deletes the row). No raw SQL — the RLS-scoped RPCs only. UTC-pinned suite →
// tomorrow is unambiguous.
const TASK = 'Take pill'

test('a recurring task gets an offset reminder; it persists and can be cleared', async ({
  page,
}) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  await placeTask(page, TASK, 0.55, 0.45)

  // From the expanded list row: make it recurring (Daily) + give it the anchor due date + time the
  // reminder leads. exact: the row-expand button's name ('Rank 1 Take pill') would substring-match.
  await switchTab(page, 'List')
  const row = page.getByRole('listitem').filter({ hasText: TASK })
  await expandRow(row)
  await row.getByRole('button', { name: 'Daily', exact: true }).click()
  await row.getByRole('button', { name: /More dates/ }).click()
  await row.getByLabel('Due date').fill(tomorrow)
  await row.getByRole('button', { name: 'Noon' }).click()

  // The SAME offset picker a one-off shows, now on a recurring task, with the per-cycle note.
  await expect(page.getByText(/before each time it comes back/i)).toBeVisible()
  const picker = page.getByTestId('reminder-picker-list')
  await picker.getByRole('button', { name: '1 hour' }).click()
  await expect(picker.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Round-trip through the DB: reload, re-open the row, the offset reads back as 1 hour.
  await page.reload()
  await switchTab(page, 'List')
  const row2 = page.getByRole('listitem').filter({ hasText: TASK })
  await expandRow(row2)
  const picker2 = page.getByTestId('reminder-picker-list')
  await expect(picker2.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Off deletes the row; the picker reflects it (reads from the refetched query).
  await picker2.getByRole('button', { name: 'Off' }).click()
  await expect(picker2.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker2.getByRole('button', { name: '1 hour' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})
