import { test, expect } from '../helpers/fixtures'
import { detectEscapes, mockAiStatus, mockPlanMyDay } from '../mocks/ai'

// Golden path: Plan My Day with the model call MOCKED (zero Anthropic spend, deterministic —
// ADR-0018). The header button generates the plan into a PERSISTENT inline card above the grid
// (not a modal); before generating, the card shows its empty state, and once a plan exists the
// pill flips to "Re-plan" (a soft confirm guards the replace). (The card also hydrates from
// daily_state.plan on load — persistence is covered by the unit tests; here we exercise the
// inline generate/regenerate flow.)
const PLAN = {
  headline: 'One big rock, then coast.',
  availableTime: '~4.5h of personal time',
  bigRock: {
    task: 'File the insurance claim',
    why: 'The deadline is close.',
    duration: '~2h',
    when: 'morning',
  },
  smallRocks: [
    { task: 'Water the plants', why: 'A quick win.', duration: '~15min', when: 'evening' },
  ],
  habitNote: 'Keep the streak alive.',
}
const REGENERATED = { ...PLAN, headline: 'Regenerated: a lighter day.' }

test('generates a mocked plan into the inline card and regenerates on demand — no real function calls', async ({
  page,
}) => {
  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const planRoute = await mockPlanMyDay(page, [PLAN, REGENERATED])

  // The inline card only materializes once a plan exists or one is generating (batch-2 rework —
  // no persistent empty-state box); with a clean slate and nothing in flight it renders nothing.
  const card = page.getByRole('region', { name: 'Plan My Day' })
  await expect(card).toHaveCount(0)

  // The header button triggers generation → the card appears and the canned plan renders inline.
  await page.getByRole('button', { name: 'Plan My Day' }).click()
  await expect(card).toBeVisible()
  await expect(card.getByText(PLAN.headline)).toBeVisible()
  await expect(card.getByText(PLAN.availableTime)).toBeVisible()
  // exact: true — getByText is case-insensitive substring by default, and the canned headline
  // ("One big rock, …") would also match the 'Big rock' pill label.
  await expect(card.getByText('Big rock', { exact: true })).toBeVisible()
  await expect(card.getByText(PLAN.bigRock.task)).toBeVisible()
  await expect(card.getByText(`⏱ ${PLAN.bigRock.duration}`)).toBeVisible()
  await expect(card.getByText(`◎ ${PLAN.bigRock.when}`)).toBeVisible()
  await expect(card.getByText(PLAN.smallRocks[0].task)).toBeVisible()
  await expect(card.getByText(`↻ ${PLAN.habitNote}`)).toBeVisible()

  // Regenerate: with a plan on screen the header pill now reads "Re-plan", and a soft confirm
  // guards the replace (so an accidental click can't silently discard the current plan).
  await page.getByRole('button', { name: 'Re-plan' }).click()
  await page
    .getByRole('dialog', { name: 'Replace the current plan?' })
    .getByRole('button', { name: 'Re-plan' })
    .click()
  await expect(card.getByText(REGENERATED.headline)).toBeVisible()
  await expect(card.getByText(PLAN.headline)).toHaveCount(0)

  // Exactly two POSTs, both served by the mock; the payload is the client-built PlanRequest
  // (clean slate → empty task list); nothing escaped to a real endpoint.
  expect(planRoute.posts()).toBe(2)
  const body = planRoute.bodies()[0] as { tasks: unknown[]; dayOfWeek: string; habits: unknown[] }
  expect(Array.isArray(body.tasks)).toBe(true)
  expect(typeof body.dayOfWeek).toBe('string')
  expect(escapes()).toEqual([])
})
