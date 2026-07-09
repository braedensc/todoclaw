import { test, expect } from '../helpers/fixtures'
import { selectManualMode, switchTab, expandRow } from '../helpers/ui'

// Due date + TIME end-to-end (the wall-clock due model): manual-add a task due tomorrow at
// 15:00, then prove the pair round-trips DB→UI — the list badge shows the localized clock
// time, the expanded-row pickers hydrate from the wire formats ('YYYY-MM-DD' / 'HH:MM:SS'),
// and both survive a full reload. "Tomorrow" is computed in UTC to match the suite's pinned
// timezoneId ('UTC' in playwright.golden.config.ts), so the badge deterministically reads
// "due tomorrow" regardless of the host clock.

test('a due time round-trips: add → badge shows it → pickers hydrate → survives reload', async ({
  page,
}) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  await selectManualMode(page)
  await page.getByLabel('Add a task').fill('Dentist appointment')
  await page.getByRole('button', { name: /due/i }).click()
  await page.getByLabel('Due date').fill(tomorrow)
  await page.getByLabel('Due time').fill('15:00')
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  await switchTab(page, 'List')
  const row = page.getByRole('listitem').filter({ hasText: 'Dentist appointment' })
  await expect(row).toContainText('due tomorrow · 3:00 PM')

  await expandRow(row)
  await expect(row.getByLabel('Due date')).toHaveValue(tomorrow)
  await expect(row.getByLabel('Due time')).toHaveValue('15:00')

  await page.reload()
  await switchTab(page, 'List')
  await expect(page.getByRole('listitem').filter({ hasText: 'Dentist appointment' })).toContainText(
    'due tomorrow · 3:00 PM',
  )
})
