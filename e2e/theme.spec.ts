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

test('a stored dark preference paints the sign-in page body with the dark --c-bg', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('todoclaw.theme', 'dark'))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // html.dark --c-bg (src/index.css) = 22 20 17.
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(22, 20, 17)')
})

// The shell's frame (TOD-139): with dark stored, the logged-out sign-in heading's text resolves to
// the dark ink, not the light one.
test('a stored dark preference colors the sign-in heading with the dark --c-ink', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('todoclaw.theme', 'dark'))
  await page.goto('/')
  const heading = page.getByRole('heading', { name: 'Sign in' })
  await expect(heading).toBeVisible()
  // html.dark --c-ink (src/index.css) = 246 241 232.
  await expect(heading).toHaveCSS('color', 'rgb(246, 241, 232)')
})

test('with no stored preference an OS dark scheme stays light (the default)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
})
