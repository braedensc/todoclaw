import { describe, expect, it } from 'vitest'
import { DayPlanSchema } from '../../types/plan'
import { TaskSchema } from '../../types/task'
import { computeClusters } from '../../lib/clustering'
import { staleness } from '../../lib/visual-urgency'
import { daysUntil } from '../../lib/scoring'
import { summarizeQuadrants, QUADRANT_ORDER } from '../../lib/quadrant-summary'
import { recurringDoneToday, recurringStatus } from '../../lib/recurring'
import { buildDemoTasks } from './demo-board'
import { DEMO_MORNING_INPUTS, DEMO_PLAN } from './demo-transcript'
import { demoTour } from './tour-steps'

// The demo fixtures are load-bearing showcase data: the plan must survive the same Zod gate a
// real plan does (DailyStateSchema's `.catch(null)` means a malformed plan silently VANISHES in
// prod code — this parse is the only tripwire), and the board must actually exercise every visual
// state its header comment advertises, TODAY and every day (it's authored relative to now).

const TZ = 'America/New_York'

describe('demo plan fixture', () => {
  it('conforms to DayPlanSchema (a malformed plan would silently not render)', () => {
    expect(() => DayPlanSchema.parse(DEMO_PLAN)).not.toThrow()
  })

  it('only plans tasks that exist on the demo board, by exact name', () => {
    const names = new Set(buildDemoTasks(TZ).map((t) => t.text))
    const rocks = [DEMO_PLAN.bigRock, ...DEMO_PLAN.smallRocks].filter(Boolean)
    for (const rock of rocks) expect(names).toContain(rock!.task)
  })
})

describe('demo board fixture', () => {
  const tasks = buildDemoTasks(TZ)
  const byId = (id: string) => tasks.find((t) => t.id === id)!

  it('parses as real Task rows', () => {
    expect(() => TaskSchema.array().parse(tasks)).not.toThrow()
  })

  it('every task actually renders on the grid (placed, live, not hidden)', () => {
    for (const t of tasks) {
      expect(t.staged, t.text).toBe(false)
      expect(t.x, t.text).not.toBeNull()
      expect(t.y, t.text).not.toBeNull()
      expect(t.completed_at, t.text).toBeNull()
      expect(t.deleted_at, t.text).toBeNull()
      // A recurring chore is hidden when done today or comfortably 'ok' — the demo one must show.
      if (t.recurring) {
        expect(recurringDoneToday(t.recurring, TZ)).toBe(false)
        expect(recurringStatus(t.recurring)?.code).not.toBe('ok')
      }
    }
  })

  it('clusters exactly the camping pair and nothing else', () => {
    const groups = computeClusters(tasks)
    const multi = groups.filter((g) => g.length > 1)
    expect(multi).toHaveLength(1)
    expect(multi[0]!.map((t) => t.id).sort()).toEqual(['demo-camping', 'demo-campsite'])
  })

  it('has exactly one ❄️ stale card (the garage), and it stays stale as time passes', () => {
    const stale = tasks.filter(
      (t) => !t.recurring && staleness(t, daysUntil(t.due, { timeZone: TZ })),
    )
    expect(stale.map((t) => t.id)).toEqual(['demo-garage'])
  })

  it('lights up all four quadrants of the mobile overview', () => {
    const { buckets } = summarizeQuadrants(tasks, { timeZone: TZ })
    for (const key of QUADRANT_ORDER) expect(buckets[key].count, key).toBeGreaterThan(0)
  })

  it('shows a due-today glow and a timed task matching the morning push', () => {
    expect(daysUntil(byId('demo-invoice').due, { timeZone: TZ })).toBe(0)
    expect(byId('demo-vet').due_time).toBe('16:30:00')
    expect(byId('demo-spanish').ongoing).toBe(true)
  })

  it('names in the transcript inputs match the board', () => {
    const names = new Set(tasks.map((t) => t.text))
    for (const t of DEMO_MORNING_INPUTS.tasks) expect(names).toContain(t.text)
  })
})

describe('demo tour script', () => {
  it('targets only demo-* anchors (grid/matrix also exist in the real shell underneath)', () => {
    for (const isMobile of [false, true])
      for (const step of demoTour(isMobile)) expect(step.target).toMatch(/^demo-/)
  })

  it('serves a breakpoint-specific first step (no glow/↻/❄️ decoder ring on mobile)', () => {
    // The mobile scene is the quadrant overview — none of the grid-card treatments exist there.
    expect(demoTour(true)[0]!.body).not.toMatch(/❄️|↻|glow/)
    expect(demoTour(false)[0]!.body).toMatch(/glow/)
  })
})
