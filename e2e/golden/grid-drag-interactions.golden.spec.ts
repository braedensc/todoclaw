import { test, expect } from '../helpers/fixtures'
import { addTask, dragNewCardToGrid, placeTask } from '../helpers/ui'
import type { Page } from '@playwright/test'

// Golden coverage for the grid-drag interaction bundle (fixes 11, 12, 16, 17, 20). These assert
// the LIVE, mid-drag feel — the pointer is held down (no `mouse.up`) while we check the DOM — so
// they guard behaviour that a place-then-assert test can't see: a tray card that must be visible
// WHILE dragging, a border that recolors as it crosses an axis, and a merge-preview flag.
//
// Screen-space fractions of the grid canvas (0..1 from top-left); data-space y is inverted, so a
// low screen y = high importance. Keep fy in the upper canvas so cards stay above the viewport
// fold and remain hoverable.
async function canvasPoint(page: Page, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId('grid-canvas').boundingBox()
  if (!box) throw new Error('grid canvas not laid out')
  return { x: box.x + box.width * fx, y: box.y + box.height * fy }
}

// (12) + (11): a new-item card must render a real, pointer-tracking card the moment the drag
// starts (not on drop), and its top border must recolor live as it crosses the urgency (0.5) axis.
test('a new-item card is visible mid-drag and its top border recolors as it crosses the axis', async ({
  page,
}) => {
  await addTask(page, 'Draft proposal')
  const newCard = page.getByTestId('new-item-card').filter({ hasText: 'Draft proposal' })
  const cardBox = await newCard.boundingBox()
  if (!cardBox) throw new Error('new-item card not laid out')

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()

  // Move onto the top-LEFT (Schedule quadrant). The first move materializes a real GridCard.
  const left = await canvasPoint(page, 0.28, 0.2)
  await page.mouse.move(left.x, left.y, { steps: 8 })

  const card = page.getByTestId('grid-card').filter({ hasText: 'Draft proposal' })
  // (12) The card tracks the pointer BEFORE we release — no invisible-until-drop gap.
  await expect(card).toBeVisible()
  // (11) Schedule top border = #3d7a5f. Set imperatively each frame from the LIVE pointer.
  await expect(card).toHaveCSS('border-top-color', 'rgb(61, 122, 95)')

  // Cross to the top-RIGHT (Do Now) — the border must flip live, still before drop.
  const right = await canvasPoint(page, 0.75, 0.2)
  await page.mouse.move(right.x, right.y, { steps: 8 })
  await expect(card).toHaveCSS('border-top-color', 'rgb(191, 94, 42)')

  await page.mouse.up()
  // Committed in Do Now; the new-item card is gone once placed.
  await expect(card).toHaveAttribute('data-quadrant', 'do-now')
  await expect(page.getByTestId('new-item-card').filter({ hasText: 'Draft proposal' })).toHaveCount(
    0,
  )
})

// Repositioning an already-placed card must still track the pointer and lift (scale 1.06) — the
// "already smooth" path. Guards the refactor that renders the dragged card standalone (so it can
// never fold into a bubble mid-drag): it must stay a single card, not double-render.
test('repositioning a placed card by its body moves it and lifts, staying a single card', async ({
  page,
}) => {
  const card = await placeTask(page, 'Movable', 0.3, 0.3) // data (0.3, 0.7) = Schedule
  await expect(card).toHaveAttribute('data-quadrant', 'schedule')
  const box = await card.boundingBox()
  if (!box) throw new Error('card not laid out')

  // Grab the card BODY (its text near the top — not a hover action) and drag to the Do Now corner.
  await page.mouse.move(box.x + box.width / 2, box.y + 10)
  await page.mouse.down()
  const target = await canvasPoint(page, 0.8, 0.18) // data (0.8, 0.82) = Do Now
  await page.mouse.move(target.x, target.y, { steps: 10 })
  await expect(card).toHaveCSS('transform', /matrix\(1\.06/) // lifted mid-drag
  await expect(page.getByTestId('grid-card')).toHaveCount(1) // no double-render

  await page.mouse.up()
  await expect(card).toHaveAttribute('data-quadrant', 'do-now')
  await expect(page.getByTestId('grid-card')).toHaveCount(1)
})

// (20): while a dragged card overlaps another within the cluster thresholds, that under-card is
// flagged `data-merge-target` (grow + darken preview); the flag clears the instant it no longer
// overlaps, and on drop.
test('dragging a card over another flags it as a merge target, cleared when moving away', async ({
  page,
}) => {
  const anchor = await placeTask(page, 'Anchor', 0.3, 0.25)
  await expect(page.locator('[data-merge-target]')).toHaveCount(0)

  await addTask(page, 'Mover')
  const mover = page.getByTestId('new-item-card').filter({ hasText: 'Mover' })
  const moverBox = await mover.boundingBox()
  if (!moverBox) throw new Error('new-item card not laid out')
  await page.mouse.move(moverBox.x + moverBox.width / 2, moverBox.y + moverBox.height / 2)
  await page.mouse.down()

  // Materialize on an empty spot, well clear of the anchor — nothing is a merge target yet.
  const away = await canvasPoint(page, 0.72, 0.5)
  await page.mouse.move(away.x, away.y, { steps: 6 })
  await expect(page.locator('[data-merge-target]')).toHaveCount(0)

  // Hover right over the anchor → it becomes THE merge target.
  const over = await canvasPoint(page, 0.3, 0.25)
  await page.mouse.move(over.x, over.y, { steps: 6 })
  await expect(anchor).toHaveAttribute('data-merge-target', '')

  // Pull away again → the preview clears without a drop.
  await page.mouse.move(away.x, away.y, { steps: 6 })
  await expect(page.locator('[data-merge-target]')).toHaveCount(0)

  await page.mouse.up()
  await expect(page.locator('[data-merge-target]')).toHaveCount(0)
})

// (16): dragging a row OUT of a cluster must separate + show the card immediately (mid-drag),
// not leave it folded into the bubble until drop.
test('dragging a task out of a cluster shows the card immediately, before drop', async ({
  page,
}) => {
  await placeTask(page, 'Renew passport', 0.6, 0.3)
  await addTask(page, 'Book flights')
  await dragNewCardToGrid(page, 'Book flights', 0.63, 0.33)

  const bubble = page.getByTestId('cluster-bubble')
  await expect(bubble).toBeVisible()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  await bubble.getByRole('button', { name: /tasks stacked here/ }).click()
  const row = page.getByTestId('cluster-popup-row').filter({ hasText: 'Book flights' })
  const rowBox = await row.boundingBox()
  if (!rowBox) throw new Error('popup row not laid out')

  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
  await page.mouse.down()
  const empty = await canvasPoint(page, 0.3, 0.6)
  await page.mouse.move(empty.x, empty.y, { steps: 8 })

  // The pulled card is a live, standalone GridCard mid-drag (it separated on pointer-down).
  const pulled = page.getByTestId('grid-card').filter({ hasText: 'Book flights' })
  await expect(pulled).toBeVisible()

  await page.mouse.up()
  // It stuck: now a standalone card and the bubble is gone (both cards separate).
  await expect(pulled).toBeVisible()
  await expect(page.getByTestId('cluster-bubble')).toHaveCount(0)
})

// (17): pressing an inline control must NOT start a drag. Covered here for the two paths research
// flagged as risky — the card's edit input and a cluster-popup row's button.
test('grabbing a placed card by its controls does not start a drag', async ({ page }) => {
  const card = await placeTask(page, 'Steady', 0.5, 0.3)
  const box = await card.boundingBox()
  if (!box) throw new Error('card not laid out')

  // A drag is unmistakable: the dragged card gets a `scale(1.06)` transform. So the truest check
  // that a control did NOT start a drag is that the card's transform never picks up that scale —
  // robust to the edit-mode layout swap that shifts the card's bounding box. `matrix(1, …)` is
  // translate-only (no scale); a drag reads `matrix(1.06, …)`.
  const notDragging = /^matrix\(1,/

  // Reveal the hover actions, then press-drag the DELETE button — it must not scale into a drag.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const del = card.getByRole('button', { name: 'Delete task' })
  const db = await del.boundingBox()
  if (!db) throw new Error('delete button not laid out')
  await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
  await page.mouse.down()
  await page.mouse.move(db.x + 120, db.y + 120, { steps: 8 })
  await expect(card).toHaveCSS('transform', notDragging)
  await page.mouse.up()
  await expect(card).toBeVisible() // released off the button → no delete, and no drag moved it

  // Same for the inline edit INPUT (the card root drops its drag handler entirely while editing).
  // Re-hover the card to reveal its actions, then open edit with a low-level click — the actions
  // are pointer-events-gated on hover, which trips .click()'s actionability wait.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const editBtn = card.getByRole('button', { name: 'Edit task' })
  const eb = await editBtn.boundingBox()
  if (!eb) throw new Error('edit button not laid out')
  await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2)
  const input = page.getByRole('textbox', { name: 'Edit task' })
  await expect(input).toBeVisible()
  const ib = await input.boundingBox()
  if (!ib) throw new Error('edit input not laid out')
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2)
  await page.mouse.down()
  await page.mouse.move(ib.x + 140, ib.y + 90, { steps: 8 })
  // After edit opens the card no longer `hasText`, so query the single grid card directly.
  await expect(page.getByTestId('grid-card')).toHaveCSS('transform', notDragging)
  await page.mouse.up()
})

test('grabbing a cluster popup row by a button does not pull the task onto the grid', async ({
  page,
}) => {
  await placeTask(page, 'Passport', 0.6, 0.3)
  await addTask(page, 'Flights')
  await dragNewCardToGrid(page, 'Flights', 0.63, 0.33)
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  await page
    .getByTestId('cluster-bubble')
    .getByRole('button', { name: /tasks stacked here/ })
    .click()
  const row = page.getByTestId('cluster-popup-row').filter({ hasText: 'Flights' })
  const del = row.getByRole('button', { name: 'Delete task' })
  const b = await del.boundingBox()
  if (!b) throw new Error('row button not laid out')

  // Press the button and drag — the row's drag-out must NOT fire (the button stops propagation),
  // so no standalone card appears on the grid.
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + 100, b.y + 120, { steps: 8 })
  await expect(page.getByTestId('grid-card').filter({ hasText: 'Flights' })).toHaveCount(0)
  await page.mouse.up()
})
