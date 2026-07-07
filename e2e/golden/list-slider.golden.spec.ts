import { test, expect } from '../helpers/fixtures'
import type { Page } from '@playwright/test'
import { placeTask, switchTab, expandRow } from '../helpers/ui'

// Golden path: the List view ranks by score (x*0.45 + y*0.55 — importance over urgency,
// src/lib/scoring.ts); committing an importance change re-ranks, and the commit runs collision
// resolution (src/lib/collision.ts) so a value landing on another card's spot gets moved to a
// free one. Both controls of an axis share one commit: the number input commits on blur.
const HIGH_TASK = 'File the insurance claim'
const LOW_TASK = 'Water the plants'

// The rank chip inside the row carries aria-label "Rank N" and renders "#N".
async function expectRank(page: Page, text: string, rank: number): Promise<void> {
  const row = page.getByRole('listitem').filter({ hasText: text })
  await expect(row.getByLabel(/^Rank \d+$/)).toHaveText(`#${rank}`)
}

test('ranking follows score; committing importance re-ranks (live quadrant badge)', async ({
  page,
}) => {
  // Screen (0.55, 0.45) → data (0.55, 0.55): score 0.55. Screen (0.25, 0.75) → data
  // (0.25, 0.25): score 0.25. Far enough apart on x (0.30 ≥ CX) that they never cluster.
  await placeTask(page, HIGH_TASK, 0.55, 0.45)
  await placeTask(page, LOW_TASK, 0.25, 0.75)

  await switchTab(page, 'List')
  await expectRank(page, HIGH_TASK, 1)
  await expectRank(page, LOW_TASK, 2)

  // Expand the low task and raise Importance to 95. The quadrant badge tracks the LIVE value
  // (before any commit): (0.25, 0.95) is important-not-urgent → "Schedule".
  const lowRow = page.getByRole('listitem').filter({ hasText: LOW_TASK })
  await expandRow(lowRow)
  await expect(lowRow.getByText('Someday', { exact: true })).toBeVisible()

  const importance = lowRow.getByLabel('Importance value')
  await importance.fill('95')
  await expect(lowRow.getByText('Schedule', { exact: true })).toBeVisible()

  // Blur commits: new score 0.25*0.45 + 0.95*0.55 = 0.635 > 0.55 → the tasks swap ranks.
  await importance.blur()
  await expectRank(page, LOW_TASK, 1)
  await expectRank(page, HIGH_TASK, 2)
})

test('a slider commit that lands on another card is collision-resolved to a free spot', async ({
  page,
}) => {
  // Same x, 0.25 apart on y (≥ CY) → separate cards. The second task sits directly below the
  // first in data space.
  await placeTask(page, HIGH_TASK, 0.55, 0.45) // data (0.55, 0.55)
  await placeTask(page, LOW_TASK, 0.55, 0.7) // data (0.55, 0.30)

  await switchTab(page, 'List')
  const lowRow = page.getByRole('listitem').filter({ hasText: LOW_TASK })
  await expandRow(lowRow)

  // Ask for importance 55 — the naive target (0.55, 0.55) is EXACTLY the other card's spot
  // (inside the 0.16/0.115 footprint), so resolveCollision must commit a nearby free spot.
  // The expanded panel re-reads the committed coords, so the requested pair (55, 55) still
  // showing after the commit would mean the spiral never ran. Which axis moves is an
  // implementation detail of the spiral constants — assert only that the pair moved.
  const urgency = lowRow.getByLabel('Urgency value')
  const importance = lowRow.getByLabel('Importance value')
  await importance.fill('55')
  await importance.blur()
  await expect(async () => {
    expect([await urgency.inputValue(), await importance.inputValue()]).not.toEqual(['55', '55'])
  }).toPass()

  // And the committed spot is genuinely clear of the other card: back on the grid both render
  // as separate cards, not a cluster bubble.
  await switchTab(page, 'Grid')
  await expect(page.getByTestId('grid-card')).toHaveCount(2)
  await expect(page.getByTestId('cluster-bubble')).toHaveCount(0)
})
