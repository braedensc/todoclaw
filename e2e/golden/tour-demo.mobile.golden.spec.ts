import { test, expect } from '../helpers/fixtures'

// Mobile (< 720px, ADR-0028) has no grid: the DemoScene shows the example day through the real
// MobileMatrix quadrant overview instead, and the same DEMO_TOUR script narrates it (scene-level
// demo-* anchors exist on both breakpoints). Act 2 then runs the trimmed MOBILE_TOUR.

test('the example peek shows a lit-up quadrant overview on mobile', async ({ page }) => {
  // The empty mobile overview offers the peek under the 2×2 grid.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  await expect(page.getByText(/none of this is your data/i)).toBeVisible()

  // The demo matrix is populated — quadrant previews list example tasks (top-3 per quadrant).
  await expect(page.getByText('Renew the passport')).toBeVisible()
  await expect(page.getByText('Clean out the garage')).toBeVisible()

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('finishing the demo act lands on the mobile walkthrough', async ({ page }) => {
  // Launch via the guide (open by default; the collapsed banner only exists after a manual
  // collapse, so "Take the tour" is directly reachable).
  await page.evaluate(() => localStorage.removeItem('todoclaw.setup-guide.dismissed'))
  await page.reload()
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()

  await expect(page.getByRole('dialog', { name: 'A board in full swing' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip to your board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'These four boxes are yours' })).toBeVisible()
})
