import { test, expect } from '../helpers/fixtures'
import { seedEisenclawFixtures } from '../helpers/db'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { switchTab, openDone } from '../helpers/ui'

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

  // Habits has no view of its own — it renders as a strip below the work region (App.tsx),
  // shown under both Grid and List. Switch back to Grid and assert it.
  await switchTab(page, 'Grid')
  const habitsSection = page.getByRole('region', { name: 'Habits' })
  await expect(
    habitsSection.getByRole('listitem').filter({ hasText: 'Wrist strengthening routine' }),
  ).toBeVisible()
  await expect(
    habitsSection.getByRole('listitem').filter({ hasText: 'Drink more water' }),
  ).toBeVisible()

  // The one permanent history entry in the source data — the Done panel shows full history
  // regardless of today's done map (Discrepancy #2, EISENCLAW-LOGIC-TO-PORT.md).
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Get a backpacking backpack' }),
  ).toBeVisible()
})
