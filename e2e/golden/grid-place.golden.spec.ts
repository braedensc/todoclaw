import { test, expect } from '../helpers/fixtures'

// Marquee golden path: it proves the whole harness end-to-end — a persisted session signs us in,
// a real task is added, a real pointer drag places it on the grid, and the placement lands in the
// expected Eisenhower quadrant.
//
// The add+drag mechanics are kept INLINE here deliberately: this spec is the canary for the drag
// harness itself, so it must not depend on the shared helpers it validates. The shared version
// every other spec uses lives in e2e/helpers/ui.ts — mirror mechanical changes there.
const TASK = 'Ship the quarterly review'

test('add a task, drag the new-item card to the grid, and assert its quadrant', async ({
  page,
}) => {
  // Add a task via the Manual input — it materializes as a draggable "new item" card in place
  // (card-in-place, B2), not on the grid yet. Scope the Add click to the Manual add form; the
  // shell has other "Add" buttons (Habits).
  await page.getByPlaceholder('manually add task…').fill(TASK)
  const captureForm = page.locator('form', { has: page.getByPlaceholder('manually add task…') })
  await captureForm.getByRole('button', { name: /^Add$/ }).click()

  const newCard = page.getByTestId('new-item-card').filter({ hasText: TASK })
  await expect(newCard).toBeVisible()

  // Real pointer drag: new-item card → top-right of the grid canvas. Data-space y is inverted, so
  // the top-right screen region maps to high urgency (x) + high importance (y) = "Do Now".
  const canvasBox = (await page.getByTestId('grid-canvas').boundingBox())!
  const cardBox = (await newCard.boundingBox())!

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
  await page.mouse.down()
  // useFreeDrag only commits a drop after a real move, so step the pointer to the target.
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.78,
    canvasBox.y + canvasBox.height * 0.22,
    {
      steps: 12,
    },
  )
  await page.mouse.up()

  // The task is now a placed grid card in the Do Now quadrant (durable data-quadrant hook).
  const gridCard = page.getByTestId('grid-card').filter({ hasText: TASK })
  await expect(gridCard).toBeVisible()
  await expect(gridCard).toHaveAttribute('data-quadrant', 'do-now')

  // It also left the widget (the new-item card is gone once placed).
  await expect(page.getByTestId('new-item-card').filter({ hasText: TASK })).toHaveCount(0)
})
