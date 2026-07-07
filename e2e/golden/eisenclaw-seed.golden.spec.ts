import { test, expect } from '../helpers/fixtures'
import { seedEisenclawFixtures } from '../helpers/db'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { switchTab, openDone, closeDone, openReminders } from '../helpers/ui'

// Proves the EisenClaw import (scripts/eisenclaw-seed/) round-trips through the real schema:
// seed Braeden's actual planner data on top of the reset test user, reload, and spot-check that
// tasks, a recurring task's badge, and habits with subtasks all render. This is the ONE golden
// spec that opts into seeded data — every other golden spec still runs against an empty slate,
// since `seedEisenclawFixtures` is called explicitly here, not from the shared `page` fixture.

test('seeded EisenClaw data renders: tasks, a recurring badge, and habits with subtasks', async ({
  page,
}) => {
  const { dbUrl } = resolveLocalSupabaseEnv()
  await seedEisenclawFixtures(dbUrl)
  await page.reload()

  await switchTab(page, 'List')
  const listSection = page.getByRole('region', { name: 'List' })
  // All 23 imported tasks are unstaged and not done — they all rank as active list rows.
  await expect(listSection.getByRole('listitem')).toHaveCount(23)
  await expect(
    listSection.getByRole('listitem').filter({ hasText: 'Find recipes for this & next week' }),
  ).toBeVisible()

  // "Laundry" is recurring with a lastDoneAt far enough in the past to always read as overdue —
  // its ↻ badge should be present regardless of when this test runs.
  const laundryRow = listSection.getByRole('listitem').filter({ hasText: 'Laundry' })
  await expect(laundryRow).toBeVisible()
  await expect(laundryRow.getByText('↻', { exact: false })).toBeVisible()

  // The one permanent history entry in the source data — the Done page shows full history
  // regardless of today's done map (Discrepancy #2, EISENCLAW-LOGIC-TO-PORT.md). Check it from the
  // home nav first, then return home before opening the reminders page (the Account nav that
  // reaches both pages lives on home, not inside a page).
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Get a backpacking backpack' }),
  ).toBeVisible()
  await closeDone(page)

  // Reminders (formerly "Habits") are a full page of their own now (ADR-0027), not a strip on the
  // main view — open it and assert the seeded reminders with subtasks render there.
  await openReminders(page)
  const remindersSection = page.getByRole('region', { name: 'Daily reminders' })
  await expect(
    remindersSection.getByRole('listitem').filter({ hasText: 'Wrist strengthening routine' }),
  ).toBeVisible()
  await expect(
    remindersSection.getByRole('listitem').filter({ hasText: 'Drink more water' }),
  ).toBeVisible()
})
