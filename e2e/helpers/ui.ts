import { expect, type Locator, type Page } from '@playwright/test'

// Shared golden-spec interactions. Every core flow starts the same way — add a task from the
// Manual input, then drag the new-item card that materializes in place onto the grid (card-in-
// place, B2 — there is no staging tray anymore) — so those mechanics live here once. The marquee
// spec (e2e/golden/grid-place.golden.spec.ts) keeps its own inline, annotated version
// deliberately: it is the harness-proving spec for the raw drag mechanics.
//
// Coordinates here are SCREEN-space fractions of the grid canvas (0..1 from the top-left).
// Data-space y is inverted from screen y (top of the canvas = high importance), so callers
// pick screen spots: e.g. (0.75, 0.25) lands in data-space (0.75, 0.75) = "Do Now".

/**
 * Switch the capture widget to Manual mode (idempotent). The widget defaults to BabyClaw (the AI
 * router), so any flow that drives the plain "manually add task…" input must select Manual first.
 */
export async function selectManualMode(page: Page): Promise<void> {
  const manual = page
    .getByRole('group', { name: 'Add mode' })
    .getByRole('button', { name: 'Manual' })
  if ((await manual.getAttribute('aria-pressed')) !== 'true') await manual.click()
  await expect(manual).toHaveAttribute('aria-pressed', 'true')
}

/** Add a task via the Manual input and wait for its draggable "new item" card to appear. */
export async function addTask(page: Page, text: string): Promise<void> {
  await selectManualMode(page)
  await page.getByPlaceholder('manually add task…').fill(text)
  // Scope to the Manual add form: the shell has other "Add" buttons (e.g. the Habits panel),
  // so an unscoped name match is ambiguous. The form is the one holding the Manual input.
  const captureForm = page.locator('form', { has: page.getByPlaceholder('manually add task…') })
  await captureForm.getByRole('button', { name: /^Add$/ }).click()
  await expect(page.getByTestId('new-item-card').filter({ hasText: text })).toBeVisible()
}

/**
 * Drag the new-item card holding `text` onto the grid at canvas fraction `(fx, fy)` with real
 * pointer events. useFreeDrag only commits a drop after an actual move, so the pointer is
 * stepped to the target.
 *
 * Keep `fy` ≲ 0.8: the 640px canvas extends below the 720px viewport fold, and pointer
 * events aimed past the fold land outside the window and are never delivered.
 */
export async function dragNewCardToGrid(
  page: Page,
  text: string,
  fx: number,
  fy: number,
): Promise<void> {
  const card = page.getByTestId('new-item-card').filter({ hasText: text })
  const canvasBox = await page.getByTestId('grid-canvas').boundingBox()
  const cardBox = await card.boundingBox()
  if (!canvasBox || !cardBox) throw new Error('grid canvas or new-item card not laid out')

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width * fx, canvasBox.y + canvasBox.height * fy, {
    steps: 12,
  })
  await page.mouse.up()
}

/**
 * Add a task and place it on the grid at canvas fraction `(fx, fy)`, waiting for the placed
 * card and returning its locator. For a drop that lands ON another card (clustering), compose
 * `addTask` + `dragNewCardToGrid` instead and assert the bubble — no card renders.
 */
export async function placeTask(
  page: Page,
  text: string,
  fx: number,
  fy: number,
): Promise<Locator> {
  await addTask(page, text)
  await dragNewCardToGrid(page, text, fx, fy)
  const card = page.getByTestId('grid-card').filter({ hasText: text })
  await expect(card).toBeVisible()
  return card
}

/**
 * Mobile tap-to-place: add a task, tap its new-item card to select it, then tap the grid canvas
 * at fraction `(fx, fy)`. The mobile counterpart of `placeTask` (which drags). Requires a mobile
 * viewport + touch (the chromium-mobile project) so `useIsMobile` exposes the card's tap-select
 * handler and the canvas commits the tap. Returns the placed card's locator.
 *
 * Aim `fy` at the UPPER canvas (≲ 0.6): the fixed bottom tab bar overlays the lower viewport on
 * mobile, so a tap near the canvas bottom can hit the nav instead of the canvas.
 */
export async function tapPlaceTask(
  page: Page,
  text: string,
  fx: number,
  fy: number,
): Promise<Locator> {
  await addTask(page, text)
  const newCard = page.getByTestId('new-item-card').filter({ hasText: text })
  await newCard.tap()
  // Selection is what arms the next grid tap; assert it before tapping the canvas.
  await expect(newCard).toHaveAttribute('aria-pressed', 'true')

  const canvas = page.getByTestId('grid-canvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('grid canvas not laid out')
  await canvas.tap({ position: { x: box.width * fx, y: box.height * fy } })

  const card = page.getByTestId('grid-card').filter({ hasText: text })
  await expect(card).toBeVisible()
  return card
}

/**
 * Switch the work view via the embedded Grid⇄List toggle and wait for it to become active.
 * Done is no longer a view (B8) — use `openDone` / `closeDone` for the history panel.
 */
export async function switchTab(page: Page, name: 'Grid' | 'List'): Promise<void> {
  const tab = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-current', 'page')
}

/**
 * Expand a list row's detail panel (sliders / due / recurring). The row BODY itself is the toggle
 * now (batch-2 item 9): a single wide `aria-expanded` button whose accessible name is the row's own
 * content (rank + text), so there is no "Expand row"-named control anymore. Match it by its
 * expandable state instead — the row's Done/Delete IconButtons carry no aria-expanded, so a
 * collapsed-button match inside the row is unambiguous.
 */
export async function expandRow(row: Locator): Promise<void> {
  await row.getByRole('button', { expanded: false }).click()
}

/** Open the Done surface from the Account nav (a `#/done` route: a centered popup on desktop, a
 * bottom sheet on mobile — either way it opens the region named "Done"). */
export async function openDone(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('button', { name: 'Done' })
    .click()
  await expect(page.getByRole('region', { name: 'Done' })).toBeVisible()
}

/** Close the Done surface (its ✕ → browser Back), returning to the view underneath. */
export async function closeDone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close done' }).click()
  await expect(page.getByRole('region', { name: 'Done' })).toHaveCount(0)
}

/**
 * Open the Daily habits page from the Account nav (ADR-0027: a route/page, not a modal).
 * DESKTOP only — the mobile bottom nav no longer has a habits tab (it moved into the More
 * sheet when Chat took its slot); a mobile spec would open More first.
 */
export async function openReminders(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('button', { name: 'Daily habits' })
    .click()
  await expect(page.getByRole('region', { name: 'Daily habits' })).toBeVisible()
}

/** Open the full chat popup: switch the input widget to BabyClaw, then "Open chat". */
export async function openChat(page: Page): Promise<void> {
  await page
    .getByRole('group', { name: 'Add mode' })
    .getByRole('button', { name: 'BabyClaw' })
    .click()
  await page.getByRole('button', { name: /Open chat/ }).click()
  await expect(page.getByRole('complementary', { name: 'Chat' })).toBeVisible()
}
