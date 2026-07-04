import { test, expect } from '../helpers/fixtures'
import { tapPlaceTask, openDone } from '../helpers/ui'

// Mobile golden path (Stage 5). Runs in the `chromium-mobile` project (Pixel 7 viewport + touch),
// so `useIsMobile` (< 720px) is true: the grid uses TAP-TO-PLACE instead of drag. The Grid⇄List
// toggle is the same embedded segmented control as on desktop (B8 retired the fixed bottom tab
// bar), just compact. The per-test DB wipe (fixtures) keeps these independent of the desktop
// specs despite the shared user.

test('tap-to-place: select a tray card, tap the grid, the card lands in the right quadrant', async ({
  page,
}) => {
  // Screen (0.75, 0.25) → data (0.75, 0.75) = Do Now (urgent + important). Upper canvas, well
  // clear of the fixed bottom bar so the tap lands on the canvas, not the nav.
  const card = await tapPlaceTask(page, 'Book the dentist', 0.75, 0.25)
  await expect(card).toHaveAttribute('data-quadrant', 'do-now')
})

test('embedded view toggle is present and completing a card flows through to the Done panel', async ({
  page,
}) => {
  // The Views toggle is the same semantic element as on desktop — an embedded segmented control,
  // usable at the mobile width (no more fixed bottom bar).
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible()

  // Place a task by tap, then complete it from the card. On mobile the card actions are always
  // visible (no hover), so the Done checkbox is tappable. `exact` avoids the header "Done" link
  // (and a recurring card's "Done (resets cycle)" control).
  const card = await tapPlaceTask(page, 'Water the plants', 0.75, 0.25)
  await card.getByRole('checkbox', { name: 'Done', exact: true }).tap()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Open the Done panel from the header; the completion is listed there.
  await openDone(page)
  const doneSection = page.getByRole('region', { name: 'Done' })
  await expect(
    doneSection.getByRole('listitem').filter({ hasText: 'Water the plants' }),
  ).toBeVisible()
})
