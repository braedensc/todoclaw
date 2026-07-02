import { expect, type Locator, type Page } from '@playwright/test'

// Shared golden-spec interactions. Every core flow starts the same way — add a task from the
// header, drag it from the staging tray onto the grid — so those mechanics live here once.
// The marquee spec (e2e/golden/grid-place.golden.spec.ts) keeps its own inline, annotated
// version deliberately: it is the harness-proving spec for the raw drag mechanics.
//
// Coordinates here are SCREEN-space fractions of the grid canvas (0..1 from the top-left).
// Data-space y is inverted from screen y (top of the canvas = high importance), so callers
// pick screen spots: e.g. (0.75, 0.25) lands in data-space (0.75, 0.75) = "Do Now".

/** Add a task via the header form and wait for it to appear in the staging tray. */
export async function addTask(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder('Add a task…').fill(text)
  await page.getByRole('button', { name: /^Add$/ }).click()
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

/** Switch top-level view via the tab nav and wait for it to become the active tab. */
export async function switchTab(
  page: Page,
  name: 'Grid' | 'List' | 'Done' | 'Habits',
): Promise<void> {
  const tab = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-current', 'page')
}
