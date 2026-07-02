import { test, expect } from '@playwright/test'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { resetTestUserData } from '../helpers/db'

// Marquee golden path: it proves the whole harness end-to-end — a persisted session signs us in,
// a real task is added, a real pointer drag places it on the grid, and the placement lands in the
// expected Eisenhower quadrant.
const TASK = 'Ship the quarterly review'

test.beforeEach(async () => {
  // Clean slate per spec (the user row + session survive; only their app rows are wiped).
  const { dbUrl } = resolveLocalSupabaseEnv()
  await resetTestUserData(dbUrl)
})

test('add a task, drag it from the tray to the grid, and assert its quadrant', async ({ page }) => {
  await page.goto('/')

  // Add a task — new tasks land in the staging tray (staged), not on the grid yet.
  await page.getByPlaceholder('Add a task…').fill(TASK)
  await page.getByRole('button', { name: /^Add$/ }).click()

  const trayCard = page.getByTestId('tray-card').filter({ hasText: TASK })
  await expect(trayCard).toBeVisible()

  // Real pointer drag: tray card → top-right of the grid canvas. Data-space y is inverted, so the
  // top-right screen region maps to high urgency (x) + high importance (y) = the "Do Now" quadrant.
  const canvasBox = (await page.getByTestId('grid-canvas').boundingBox())!
  const cardBox = (await trayCard.boundingBox())!

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

  // It also left the tray.
  await expect(page.getByTestId('tray-card').filter({ hasText: TASK })).toHaveCount(0)
})
