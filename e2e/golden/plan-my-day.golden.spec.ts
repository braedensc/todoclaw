import { test, expect } from '../helpers/fixtures'
import { detectEscapes, mockAiStatus, mockPlanMyDay } from '../mocks/ai'

// Golden path: Plan My Day with the model call MOCKED (zero Anthropic spend, deterministic —
// ADR-0018). The panel auto-generates once its data queries settle, renders the structured
// plan (headline, big rock, small rocks, habit note), and Regenerate fetches a fresh one.
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

test('renders a mocked plan and regenerates on demand — no real function calls', async ({
  page,
}) => {
  const escapes = await detectEscapes(page)
  await mockAiStatus(page)
  const planRoute = await mockPlanMyDay(page, [PLAN, REGENERATED])

  await page.getByRole('button', { name: 'Plan My Day' }).click()
  const dialog = page.getByRole('dialog', { name: 'Plan My Day' })
  await expect(dialog).toBeVisible()

  // Auto-generate fires once the task/habit/daily queries settle → the canned plan renders.
  await expect(dialog.getByText(PLAN.headline)).toBeVisible()
  await expect(dialog.getByText(PLAN.availableTime)).toBeVisible()
  // exact: true — getByText is case-insensitive substring by default, and the canned headline
  // ("One big rock, …") would also match the 'Big rock' section label.
  await expect(dialog.getByText('Big rock', { exact: true })).toBeVisible()
  await expect(dialog.getByText(PLAN.bigRock.task)).toBeVisible()
  await expect(dialog.getByText(`${PLAN.bigRock.when} · ${PLAN.bigRock.duration}`)).toBeVisible()
  await expect(dialog.getByText('Small rocks', { exact: true })).toBeVisible()
  await expect(dialog.getByText(PLAN.smallRocks[0].task)).toBeVisible()
  await expect(dialog.getByText(PLAN.habitNote)).toBeVisible()

  // Regenerate → a second (different) plan replaces the first.
  await dialog.getByRole('button', { name: 'Regenerate' }).click()
  await expect(dialog.getByText(REGENERATED.headline)).toBeVisible()
  await expect(dialog.getByText(PLAN.headline)).toHaveCount(0)

  // Exactly two POSTs, both served by the mock; the payload is the client-built PlanRequest
  // (clean slate → empty task list); nothing escaped to a real endpoint.
  expect(planRoute.posts()).toBe(2)
  const body = planRoute.bodies()[0] as { tasks: unknown[]; dayOfWeek: string; habits: unknown[] }
  expect(Array.isArray(body.tasks)).toBe(true)
  expect(typeof body.dayOfWeek).toBe('string')
  expect(escapes()).toEqual([])
})
