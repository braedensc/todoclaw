import { test, expect } from '@playwright/test'

// Smoke: the SPA boots and, when logged out, renders the sign-in form. Proves the build +
// dev server + Playwright wiring end to end without needing a database.
test('boots and shows the sign-in form when logged out', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'TodoClaw' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible()
})
