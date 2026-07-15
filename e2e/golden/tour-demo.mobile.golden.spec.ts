import { test, expect } from '../helpers/fixtures'

// Mobile (< 720px, ADR-0028) has no grid: the DemoScene shows the example day through the real
// MobileMatrix quadrant overview instead, mounted inline below the real masthead (never a covering
// overlay), and the same one-section demoTour narrates it (scene-level demo-* anchors exist on both
// breakpoints; only the BOARD step's copy differs per breakpoint).

test('the example peek shows a lit-up quadrant overview on mobile', async ({ page }) => {
  // The empty mobile overview offers the peek under the 2×2 grid.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()

  // The demo matrix is populated — quadrant previews list example tasks (top-3 per quadrant).
  await expect(page.getByText('Renew the passport')).toBeVisible()
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('the tour walks the example day with mobile board copy', async ({ page }) => {
  // Launch via the guide (open by default; the collapsed banner only exists after a manual
  // collapse, so "Take the tour" is directly reachable).
  await page.evaluate(() => localStorage.removeItem('todoclaw.setup-guide.dismissed'))
  await page.reload()
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()

  await expect(page.getByRole('dialog', { name: 'Welcome to Todoclaw' })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // The board step's mobile copy names the quadrant boxes ("Do Now") — no grid ↻/❄️ decoder ring.
  const board = page.getByRole('dialog', { name: 'Sorted by what matters' })
  await expect(board).toBeVisible()
  await expect(board).toContainText('Do Now')
  await expect(board).not.toContainText('❄️')
})
