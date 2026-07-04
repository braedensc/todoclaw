import { test, expect } from '../helpers/fixtures'
import { detectEscapes, mockAiStatus, mockPlanMyDay } from '../mocks/ai'

// Golden path: Plan My Day with the model call MOCKED (zero Anthropic spend, deterministic —
// ADR-0018). The header button generates the plan into a PERSISTENT inline card above the grid
// (not a modal); before generating, the card shows its empty state, and clicking the header
// button again regenerates. (The card also hydrates from daily_state.plan on load — persistence
// is covered by the unit tests; here we exercise the inline generate/regenerate flow.)
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

  // The inline card is always present (no modal); before generating it shows the empty state.
  const card = page.getByRole('region', { name: 'Plan My Day' })
  await expect(card).toBeVisible()
  await expect(card.getByText(/reads your grid, recurring chores, and habits/i)).toBeVisible()

  // The header button triggers generation → the canned plan renders inline in the card.
  await page.getByRole('button', { name: 'Plan My Day' }).click()
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

  // Regenerate via the same header button → a second (different) plan replaces the first.
  await page.getByRole('button', { name: 'Plan My Day' }).click()
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
