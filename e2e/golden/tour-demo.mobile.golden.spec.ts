import { test, expect } from '../helpers/fixtures'

// Mobile's everyday shell has no inline grid (ADR-0028) — but Grid view does, so the DemoScene
// shows a phone BOTH: the real touch grid (embedded) where the urgency × importance model is
// legible, then the real MobileMatrix quadrant overview it actually opens on. The same one-section
// demoTour narrates them, with one extra panel on this breakpoint for the overview, and the
// bottom-bar tab a panel is about ringed alongside the panel itself.

test('the example peek shows both the grid and the quadrant overview on mobile', async ({
  page,
}) => {
  // The empty mobile overview offers the peek under the 2×2 grid.
  await page.getByRole('button', { name: 'See an example board', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()

  // Both boards are populated with the same example day. Scoped per anchor: the task names now
  // appear on the grid AND in the overview's quadrant previews, so a bare getByText is ambiguous.
  await expect(
    page.locator('[data-tour="demo-grid"]').getByText('Clean out the garage'),
  ).toBeVisible()
  await expect(
    page.locator('[data-tour="demo-matrix"]').getByText('Renew the passport'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('the tour walks the grid, then the overview, then the add UI', async ({ page }) => {
  // Launch via the guide (open by default; the collapsed banner only exists after a manual
  // collapse, so "Take the tour" is directly reachable).
  await page.evaluate(() => localStorage.removeItem('todoclaw.setup-guide.dismissed'))
  await page.reload()
  await page.getByRole('button', { name: 'Take the tour', exact: true }).click()

  // Panel 1 opens on the REAL masthead at the top of the app, not mid-board.
  await expect(page.getByRole('dialog', { name: 'Welcome to TodoClaw' })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Panel 2 is the grid — the phone's own way in is the ▦ Grid button, and none of the desktop
  // card decoder ring (↻ / ❄️) exists on touch chips, so the copy must not teach it.
  const board = page.getByRole('dialog', { name: 'Sorted by what matters' })
  await expect(board).toBeVisible()
  await expect(board).toContainText('Grid')
  await expect(board).not.toContainText('❄️')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Panel 3 is the phone-only quadrant overview, named as the quicker read of the same board.
  const overview = page.getByRole('dialog', { name: 'Or the quick overview' })
  await expect(overview).toBeVisible()
  await expect(overview).toContainText('Do Now')
  await page.getByRole('button', { name: 'Next', exact: true }).click()

  // Panel 4 spotlights the real add UI AND rings the ✚ tab in the bottom bar, so the surface and
  // the button that opens it are learned together.
  await expect(page.getByRole('dialog', { name: 'Three kinds of task' })).toBeVisible()
  await expect(page.getByTestId('tour-also')).toBeVisible()
  await expect(
    page.locator('[data-tour="demo-add"]').getByText('Ongoing', { exact: true }),
  ).toBeVisible()
})
