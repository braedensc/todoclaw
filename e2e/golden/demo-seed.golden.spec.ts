import { test, expect } from '../helpers/fixtures'
import { seedDemoFixtures } from '../helpers/db'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { switchTab, openDone, closeDone, openReminders } from '../helpers/ui'

// Proves the demo seed (scripts/demo-seed/) round-trips through the real schema: seed the
// checked-in demo dataset on top of the reset test user, reload, and spot-check that tasks, a
// recurring task's badge, a permanent history entry, and habits with subtasks all render. This is
// the ONE golden spec that opts into seeded data — every other golden spec still runs against an
// empty slate, since `seedDemoFixtures` is called explicitly here, not from the shared `page`
// fixture. Assertions track scripts/demo-seed/data.ts (DEMO_STATE) — keep the two in sync.

test('seeded demo data renders: tasks, a recurring badge, and habits with subtasks', async ({
  page,
}) => {
  const { dbUrl } = resolveLocalSupabaseEnv()
  await seedDemoFixtures(dbUrl)
  await page.reload()

  await switchTab(page, 'List')
  const listSection = page.getByRole('region', { name: 'List' })
  // All 8 demo tasks are unstaged and not done — they all rank as active list rows.
  await expect(listSection.getByRole('listitem')).toHaveCount(8)
  await expect(
    listSection.getByRole('listitem').filter({ hasText: 'Submit the quarterly report' }),
  ).toBeVisible()

  // "Water the plants" is recurring with a lastDoneAt far enough in the past to always read as
  // overdue — its ↻ badge should be present regardless of when this test runs.
  const recurringRow = listSection.getByRole('listitem').filter({ hasText: 'Water the plants' })
  await expect(recurringRow).toBeVisible()
  await expect(recurringRow.getByText('↻', { exact: false })).toBeVisible()

  // The one permanent history entry in the demo data — the Done page shows full history
  // regardless of today's done map. Check it from the home nav first, then return home before
  // opening the reminders page (the Account nav that reaches both pages lives on home).
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Frame the trail photos' }),
  ).toBeVisible()
  await closeDone(page)

  // Reminders (formerly "Habits") are a full page of their own now (ADR-0027), not a strip on the
  // main view — open it and assert the seeded habits with subtasks render there.
  await openReminders(page)
  const remindersSection = page.getByRole('region', { name: 'Daily habits' })
  await expect(
    remindersSection.getByRole('listitem').filter({ hasText: 'Morning stretch routine' }),
  ).toBeVisible()
  await expect(
    remindersSection.getByRole('listitem').filter({ hasText: 'Read before bed' }),
  ).toBeVisible()
})
