import { test, expect } from '../helpers/fixtures'
import { tapPlaceTask, switchTab } from '../helpers/ui'

// Mobile golden path (Stage 5). Runs in the `chromium-mobile` project (Pixel 7 viewport + touch),
// so `useIsMobile` (< 720px) is true: the grid uses TAP-TO-PLACE instead of drag and the view nav
// is a fixed BOTTOM tab bar. These are the behaviours that genuinely differ from desktop; the
// per-test DB wipe (fixtures) keeps them independent of the desktop specs despite the shared user.

test('tap-to-place: select a tray card, tap the grid, the card lands in the right quadrant', async ({
  page,
}) => {
  // Screen (0.75, 0.25) → data (0.75, 0.75) = Do Now (urgent + important). Upper canvas, well
  // clear of the fixed bottom bar so the tap lands on the canvas, not the nav.
  const card = await tapPlaceTask(page, 'Book the dentist', 0.75, 0.25)
  await expect(card).toHaveAttribute('data-quadrant', 'do-now')
})

test('bottom tab bar: nav sits at the bottom and completing a card flows through to Done', async ({
  page,
}) => {
  // The Views nav is the same semantic element as on desktop, repositioned to a bottom bar.
  const nav = page.getByRole('navigation', { name: 'Views' })
  const navBox = await nav.boundingBox()
  const viewport = page.viewportSize()
  if (!navBox || !viewport) throw new Error('nav or viewport not measured')
  // It should sit in the bottom half of the viewport (a bottom bar, not a top row).
  expect(navBox.y).toBeGreaterThan(viewport.height / 2)

  // Place a task by tap, then complete it from the card. On mobile the card actions are always
  // visible (no hover), so the Done checkbox is tappable. `exact` avoids the "Done" tab button
  // (and a recurring card's "Done (resets cycle)" control).
  const card = await tapPlaceTask(page, 'Water the plants', 0.75, 0.25)
  await card.getByRole('checkbox', { name: 'Done', exact: true }).tap()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Navigate to the Done tab via the bottom bar; the completion is listed there.
  await switchTab(page, 'Done')
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Water the plants' }),
  ).toBeVisible()
})
