import { expect, type Locator, type Page } from '@playwright/test'

// Shared golden-spec interactions. Every core flow starts the same way — add a task from the
// header, drag it from the staging tray onto the grid — so those mechanics live here once.
// The marquee spec (e2e/golden/grid-place.golden.spec.ts) keeps its own inline, annotated
// version deliberately: it is the harness-proving spec for the raw drag mechanics.
//
// Coordinates here are SCREEN-space fractions of the grid canvas (0..1 from the top-left).
// Data-space y is inverted from screen y (top of the canvas = high importance), so callers
// pick screen spots: e.g. (0.75, 0.25) lands in data-space (0.75, 0.75) = "Do Now".

/** Add a task via the Manual input widget and wait for it to appear as a staging chip. */
export async function addTask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder('manually add task…').fill(text)
  // Scope to the Manual add form: the shell has other "Add" buttons (e.g. the Habits panel),
  // so an unscoped name match is ambiguous. The form is the one holding the Manual input.
  const captureForm = page.locator('form', { has: page.getByPlaceholder('manually add task…') })
  await captureForm.getByRole('button', { name: /^Add$/ }).click()
  await expect(page.getByTestId('tray-card').filter({ hasText: text })).toBeVisible()
}

/**
 * Drag the tray card holding `text` onto the grid at canvas fraction `(fx, fy)` with real
 * pointer events. useFreeDrag only commits a drop after an actual move, so the pointer is
 * stepped to the target.
 *
 * Keep `fy` ≲ 0.8: the 640px canvas extends below the 720px viewport fold, and pointer
 * events aimed past the fold land outside the window and are never delivered.
 */
export async function dragTrayCardToGrid(
  page: Page,
  text: string,
  fx: number,
  fy: number,
): Promise<void> {
  const trayCard = page.getByTestId('tray-card').filter({ hasText: text })
  const canvasBox = await page.getByTestId('grid-canvas').boundingBox()
  const cardBox = await trayCard.boundingBox()
  if (!canvasBox || !cardBox) throw new Error('grid canvas or tray card not laid out')

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
 * `addTask` + `dragTrayCardToGrid` instead and assert the bubble — no card renders.
 */
export async function placeTask(
  page: Page,
  text: string,
  fx: number,
  fy: number,
): Promise<Locator> {
  await addTask(page, text)
  await dragTrayCardToGrid(page, text, fx, fy)
  const card = page.getByTestId('grid-card').filter({ hasText: text })
  await expect(card).toBeVisible()
  return card
}

/**
 * Mobile tap-to-place: add a task, tap its tray card to select it, then tap the grid canvas at
 * fraction `(fx, fy)`. The mobile counterpart of `placeTask` (which drags). Requires a mobile
 * viewport + touch (the chromium-mobile project) so `useIsMobile` exposes the tray tap-select
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
  const trayCard = page.getByTestId('tray-card').filter({ hasText: text })
  await trayCard.tap()
  // Selection is what arms the next grid tap; assert it before tapping the canvas.
  await expect(trayCard).toHaveAttribute('aria-pressed', 'true')

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

/** Open the Done history panel from the header (B8: Done is a header link, not a view). */
export async function openDone(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Account' })
    .getByRole('button', { name: 'Done' })
    .click()
  await expect(page.getByRole('region', { name: 'Done' })).toBeVisible()
}

/** Close the Done history panel, returning to the view underneath. */
export async function closeDone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close done' }).click()
  await expect(page.getByRole('region', { name: 'Done' })).toHaveCount(0)
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
