import { test, expect } from '@playwright/test'

// Theme boot (TOD-137), logged out like smoke.spec.ts: public/theme-boot.js must apply the stored
// device-local preference before the app renders the sign-in page.
test('a stored dark preference puts the dark class on <html>', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('todoclaw.theme', 'dark'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#161411')
})

test('with no stored preference an OS dark scheme stays light (the default)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
})
