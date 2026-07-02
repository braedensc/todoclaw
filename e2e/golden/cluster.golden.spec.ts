import { test, expect } from '../helpers/fixtures'
import { addTask, dragTrayCardToGrid, placeTask } from '../helpers/ui'

// Golden path: overlapping cards collapse into a cluster bubble; clicking it opens the popup
// listing the stacked tasks; clicking the grid background dismisses it. Placement spots are
// chosen against the real thresholds (CX=0.09, CY=0.07 in src/lib/clustering.ts): the two
// drops below differ by 0.03 on each axis — well inside — so they must cluster.
const TASK_A = 'Renew passport'
const TASK_B = 'Book flights'

test('overlapping drops cluster into a bubble; the popup lists both tasks', async ({ page }) => {
  // First card placed normally at screen (0.70, 0.30) → data (0.70, 0.70).
  await placeTask(page, TASK_A, 0.7, 0.3)

  // Second drop lands 0.03 away on each axis → clusters with the first; the group renders as
  // ONE bubble (no standalone card), so compose the primitives and assert the bubble.
  await addTask(page, TASK_B)
  await dragTrayCardToGrid(page, TASK_B, 0.73, 0.33)

  // The bubble replaces both cards and shows the stack count.
  const bubble = page.getByTestId('cluster-bubble')
  const stack = bubble.getByRole('button', { name: '2 tasks stacked here' })
  await expect(stack).toBeVisible()
  await expect(page.getByTestId('grid-card')).toHaveCount(0)

  // Open the popup: a dialog headed "2 tasks here" with one row per stacked task.
  await stack.click()
  const popup = page.getByTestId('cluster-popup')
  await expect(popup).toBeVisible()
  await expect(popup).toHaveText(/2 tasks here/)
  await expect(popup.getByTestId('cluster-popup-row')).toHaveCount(2)
  await expect(popup.getByTestId('cluster-popup-row').filter({ hasText: TASK_A })).toBeVisible()
  await expect(popup.getByTestId('cluster-popup-row').filter({ hasText: TASK_B })).toBeVisible()

  // Clicking the OPEN bubble toggles the popup closed (regression: a leaked pointerdown used
  // to hit the canvas dismiss handler first, so this click closed-then-instantly-reopened).
  await stack.click()
  await expect(popup).toHaveCount(0)

  // …and clicking it again reopens, for the background-dismiss check below.
  await stack.click()
  await expect(popup).toBeVisible()

  // Clicking empty grid background dismisses the popup (the bubble stays). Use a TOP-area
  // spot: the 640px canvas extends below the 720px viewport fold, so a bottom-fraction click
  // would land outside the window and never reach the canvas.
  const canvasBox = await page.getByTestId('grid-canvas').boundingBox()
  if (!canvasBox) throw new Error('grid canvas not laid out')
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.1, canvasBox.y + canvasBox.height * 0.12)
  await expect(popup).toHaveCount(0)
  await expect(bubble).toBeVisible()
})
