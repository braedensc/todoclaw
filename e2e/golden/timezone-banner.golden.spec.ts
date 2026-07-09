import { test, expect } from '@playwright/test'

// The timezone-mismatch banner (TimezoneMismatchBanner). auth.setup seeded
// user_schedule.timezone from ITS browser context — the host zone — while this whole file runs
// with the context clock in Auckland, so the app sees a guaranteed stored≠device mismatch
// (assuming the host isn't in Auckland). Deliberately mutation-free: we exercise "Keep" (a
// localStorage dismissal), never "Switch" (which would rewrite the shared test user's timezone
// and leak a mismatch banner into every later spec this run). Switch is covered by the
// component test.
test.use({ timezoneId: 'Pacific/Auckland' })

const banner = (page: import('@playwright/test').Page) =>
  page.getByRole('status').filter({ hasText: 'Todoclaw is set to' })

test('mismatch banner names both zones; Keep dismisses and persists across reload', async ({
  page,
}) => {
  await page.goto('/')
  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toContainText('Auckland')
  await expect(banner(page)).toContainText(/due dates, reminders, and the daily reset/i)

  await banner(page).getByRole('button', { name: /keep/i }).click()
  await expect(banner(page)).toHaveCount(0)

  // The dismissal is remembered per zone-pair (localStorage) — a reload must not re-prompt.
  await page.reload()
  await expect(page.getByRole('group', { name: 'Add mode' })).toBeVisible() // shell settled
  await expect(banner(page)).toHaveCount(0)
})
