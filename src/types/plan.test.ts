import { describe, expect, it } from 'vitest'
import { DayPlanSchema } from './plan'

// The persisted-plan read boundary (daily_state.plan → DayPlanSchema in DailyStateSchema). The
// taskId field arrived 2026-07-21; plans stored before it must keep parsing, and a stored taskId
// must survive the parse (zod strips unknown keys — a schema that forgot the field would silently
// drop the strikethrough link on every reload).

const rock = { task: 'File taxes', why: 'Due.', duration: '~1h', when: 'afternoon' as const }
const base = {
  headline: 'Steady.',
  availableTime: '~4h',
  bigRock: rock,
  smallRocks: [rock],
  habitNote: 'Keep it up.',
}

describe('DayPlanSchema taskId', () => {
  it('a legacy plan without taskId still parses (absent stays absent/undefined)', () => {
    const parsed = DayPlanSchema.parse(base)
    expect(parsed.bigRock?.taskId ?? null).toBeNull()
  })

  it('a stored taskId round-trips the parse instead of being stripped', () => {
    const parsed = DayPlanSchema.parse({
      ...base,
      bigRock: { ...rock, taskId: 'task-1' },
      smallRocks: [{ ...rock, taskId: null }],
    })
    expect(parsed.bigRock?.taskId).toBe('task-1')
    expect(parsed.smallRocks[0]?.taskId).toBeNull()
  })

  it('a malformed taskId (user-writable jsonb) degrades to null, not a dead plan card', () => {
    const parsed = DayPlanSchema.parse({ ...base, bigRock: { ...rock, taskId: 42 } })
    expect(parsed.bigRock?.taskId).toBeNull()
    expect(parsed.headline).toBe('Steady.')
  })
})

describe('DayPlanSchema nudge (the optional quiet-day suggestion)', () => {
  const nudge = { task: 'Write the novel', why: 'A relaxed hour helps.', duration: '~1h' }

  it('a legacy plan without a nudge still parses (absent stays null/undefined)', () => {
    const parsed = DayPlanSchema.parse(base)
    expect(parsed.nudge ?? null).toBeNull()
  })

  it('a quiet-day nudge round-trips the parse, taskId included', () => {
    const parsed = DayPlanSchema.parse({
      ...base,
      bigRock: null,
      smallRocks: [],
      nudge: { ...nudge, taskId: 'task-9' },
    })
    expect(parsed.nudge?.task).toBe('Write the novel')
    expect(parsed.nudge?.taskId).toBe('task-9')
  })

  it('a malformed nudge (user-writable jsonb) degrades to null, not a dead plan card', () => {
    const parsed = DayPlanSchema.parse({ ...base, nudge: 'just do something' })
    expect(parsed.nudge ?? null).toBeNull()
    expect(parsed.headline).toBe('Steady.')
  })
})

// Fixed-time anchors (2026-07-27). Same read-boundary contract as taskId/nudge: plans persisted
// before the field must keep parsing, a stored anchor must survive (zod strips unknown keys — a
// schema that forgot the field would drop the day's appointments on every reload), and a malformed
// value degrades to no-anchors rather than nuking the card.
describe('DayPlanSchema anchors', () => {
  const anchor = { task: 'Timing belt & water pump', time: '2:00 PM', taskId: 'car' }

  it('a legacy plan without anchors still parses', () => {
    expect(DayPlanSchema.parse(base).anchors ?? null).toBeNull()
  })

  it('stored anchors round-trip the parse instead of being stripped', () => {
    const parsed = DayPlanSchema.parse({ ...base, anchors: [anchor] })
    expect(parsed.anchors).toEqual([anchor])
  })

  it('a malformed anchors value degrades to null, not a dead plan card', () => {
    const parsed = DayPlanSchema.parse({ ...base, anchors: 'at 2pm' })
    expect(parsed.anchors ?? null).toBeNull()
    expect(parsed.headline).toBe('Steady.')
  })
})

// The due-now strip + the strips' overflow counts. Same read-boundary contract as anchors above:
// a plan persisted before either field must keep parsing, a stored value must survive the parse
// (zod strips unknown keys — a schema that forgot the field would drop the strip on every reload),
// and a malformed value must degrade to nothing rather than nuking the card.
describe('DayPlanSchema dueToday + overflow', () => {
  const due = { task: 'File the visa application', status: 'due today', taskId: 'visa' }

  it('a legacy plan without either field still parses', () => {
    expect(DayPlanSchema.parse(base).dueToday ?? null).toBeNull()
    expect(DayPlanSchema.parse(base).overflow ?? null).toBeNull()
  })

  it('a stored strip and its counts round-trip the parse', () => {
    const parsed = DayPlanSchema.parse({
      ...base,
      dueToday: [due],
      overflow: { anchors: 0, chores: 1, dueToday: 2 },
    })
    expect(parsed.dueToday).toEqual([due])
    expect(parsed.overflow).toEqual({ anchors: 0, chores: 1, dueToday: 2 })
  })

  it('malformed values degrade to null, not a dead plan card', () => {
    const parsed = DayPlanSchema.parse({ ...base, dueToday: 'five things', overflow: 7 })
    expect(parsed.dueToday ?? null).toBeNull()
    expect(parsed.overflow ?? null).toBeNull()
    expect(parsed.headline).toBe('Steady.')
  })

  it('one malformed count degrades on its own without taking the strip with it', () => {
    const parsed = DayPlanSchema.parse({
      ...base,
      dueToday: [due],
      overflow: { anchors: 'lots', chores: 0, dueToday: 2 },
    })
    expect(parsed.dueToday).toEqual([due])
    expect(parsed.overflow?.anchors ?? null).toBeNull()
    expect(parsed.overflow?.dueToday).toBe(2)
  })
})
