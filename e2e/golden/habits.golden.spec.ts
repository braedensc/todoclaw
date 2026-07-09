import { test, expect } from '../helpers/fixtures'
import { openReminders } from '../helpers/ui'

// Golden path: add a daily reminder (habit), check it off for today, add a step (subtask) and
// check that too — then reload to prove the checks persisted to daily_state (they reset each local
// day by reading a fresh date-keyed row, so "checked" must survive a reload within the same day).
// The full reminders view lives on the Daily reminders page (ADR-0027) — open it from the Account
// nav first. UI copy says "reminders"; the underlying hooks/labels keep "habit" identifiers.
const HABIT = 'Morning stretch'
const STEP = 'Neck rolls'

test('add a reminder, check it and a step for today; checks survive a reload', async ({ page }) => {
  await openReminders(page)
  const habitsSection = page.getByRole('region', { name: 'Daily habits' })

  // Add the habit — it lands in the active list with an unchecked daily checkbox.
  await habitsSection.getByPlaceholder('Add a habit…').fill(HABIT)
  await habitsSection.getByRole('button', { name: /^Add$/ }).click()
  const habitCheck = page.getByLabel(`Mark "${HABIT}" done today`)
  await expect(habitCheck).toBeVisible()
  await expect(habitCheck).not.toBeChecked()

  // Check it off for today. click() rather than check(): the checkbox is CONTROLLED — it only
  // flips once the daily_state write + refetch land, so check()'s immediate post-click
  // verification would see the React revert and fail. toBeChecked() retries until it flips.
  await habitCheck.click()
  await expect(habitCheck).toBeChecked()

  // Expand the steps panel and add a step. Scope the Add button to the habit row — the
  // add-a-habit form at the bottom of the section has its own Add button.
  const row = habitsSection.getByRole('listitem').filter({ hasText: HABIT })
  await row.getByLabel(`Show steps for "${HABIT}"`).click()
  await expect(row.getByText('No steps yet — add one below.')).toBeVisible()
  await row.getByLabel(`Add a step to "${HABIT}"`).fill(STEP)
  await row.getByRole('button', { name: /^Add$/ }).click()

  // Check the step for today (click(), not check() — same controlled-checkbox semantics).
  const stepCheck = row.getByLabel(`Mark step "${STEP}" done today`)
  await expect(stepCheck).toBeVisible()
  await stepCheck.click()
  await expect(stepCheck).toBeChecked()

  // Master switch: the habit checkbox cascades to its steps in BOTH directions — unchecking the
  // habit clears the step, re-checking checks it again (each write is its own set_daily_flag).
  await habitCheck.click()
  await expect(habitCheck).not.toBeChecked()
  await expect(stepCheck).not.toBeChecked()
  await habitCheck.click()
  await expect(habitCheck).toBeChecked()
  await expect(stepCheck).toBeChecked()

  // Reload: the session persists (storageState) and today's daily_state row still holds both
  // checks — this proves the writes landed server-side, not just in component state.
  // (Locators are lazy queries, so the pre-reload `row`/`habitCheck` re-resolve fine here.)
  await page.reload()
  await expect(habitCheck).toBeChecked()
  await row.getByLabel(`Show steps for "${HABIT}"`).click()
  await expect(row.getByLabel(`Mark step "${STEP}" done today`)).toBeChecked()
})
