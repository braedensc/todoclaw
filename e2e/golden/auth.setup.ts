import { test as setup, expect } from '@playwright/test'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { ensureTestUser } from '../helpers/admin'
import { resetTestUserData } from '../helpers/db'
import { TEST_USER, AUTH_STATE_PATH } from '../helpers/constants'

// Setup project — runs once before every golden spec (wired via `dependencies: ['setup']` in
// playwright.golden.config.ts). The DB-backed suite needs a signed-in session: the app is
// sign-in-only, so we create the account via the admin API, wipe its data for a clean slate,
// then drive the REAL sign-in form and persist the resulting session (storageState). Driving the
// real form captures whatever localStorage key supabase-js uses — no hand-rolled token JSON.
// Implemented as a setup project (not a bare globalSetup) so the dev server is guaranteed up when
// we sign in. See ADR-0018.
setup('authenticate', async ({ page }) => {
  const { apiUrl, serviceRoleKey, dbUrl } = resolveLocalSupabaseEnv()

  await ensureTestUser(apiUrl, serviceRoleKey)
  await resetTestUserData(dbUrl)

  await page.goto('/')
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email)
  await page.getByPlaceholder('Password').fill(TEST_USER.password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // The app shell renders once the session resolves. Assert two shell-only, mode-agnostic elements
  // that never appear on the sign-in screen: the Add-mode toggle (the app defaults to BabyClaw, so
  // the Manual input isn't in the DOM until you switch) and the Views toggle.
  await expect(page.getByRole('group', { name: 'Add mode' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible()

  await page.context().storageState({ path: AUTH_STATE_PATH })
})
