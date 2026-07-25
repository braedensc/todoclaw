import { describe, expect, it } from 'vitest'
import { DayPlanSchema } from '../../types/plan'
import { TaskSchema } from '../../types/task'
import { computeClusters } from '../../lib/clustering'
import { staleness } from '../../lib/visual-urgency'
import { daysUntil } from '../../lib/scoring'
import { summarizeQuadrants, QUADRANT_ORDER } from '../../lib/quadrant-summary'
import { recurringDoneToday, recurringStatus } from '../../lib/recurring'
import { HabitSchema } from '../../types/habit'
import { buildDemoTasks, buildDemoHabits, DEMO_HABIT_DONE } from './demo-board'
import { DEMO_MORNING, DEMO_MORNING_INPUTS, DEMO_PLAN } from './demo-transcript'
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

describe('demo habits fixture', () => {
  it('parses as real Habit rows', () => {
    expect(() => HabitSchema.array().parse(buildDemoHabits())).not.toThrow()
  })

  it('every habit actually renders in the strip (which shows NOTHING when none are active)', () => {
    // RemindersInline early-returns null on an empty active list, so an empty/inactive fixture
    // would leave the tour's habits panel spotlighting a zero-height sliver — silently.
    const habits = buildDemoHabits()
    expect(habits.length).toBeGreaterThan(0)
    for (const h of habits) {
      expect(h.active, h.text).toBe(true)
      expect(h.deleted_at, h.text).toBeNull()
    }
  })

  it('seeds exactly the habits the morning push lists (one coherent example day)', () => {
    for (const h of buildDemoHabits()) expect(DEMO_MORNING.body).toContain(h.text)
  })

  it('ticks some but not all of them, so the strip shows both paw treatments', () => {
    const habits = buildDemoHabits()
    const ticked = habits.filter((h) => DEMO_HABIT_DONE[h.id])
    expect(ticked.length).toBeGreaterThan(0)
    expect(ticked.length).toBeLessThan(habits.length)
  })
})

describe('demo tour script', () => {
  it('opens on the real masthead, closes on the real nav, and points at demo-* in between', () => {
    // The first and last steps deliberately target REAL shell chrome — the masthead (so the tour
    // starts at the top of the app, not mid-board) and the Account nav / bottom bar. Everything
    // between them is DemoScene's own scenery, prefixed `demo-` because 'grid' and 'matrix' also
    // exist in the real shell underneath and anchors resolve first-match-in-document.
    for (const isMobile of [false, true]) {
      const steps = demoTour(isMobile)
      expect(steps[0]!.target).toBe('app-top')
      for (const step of steps.slice(1, -1)) expect(step.target).toMatch(/^demo-/)
      expect(steps.at(-1)!.target).toBe('options')
    }
  })

  it('teaches the two-parameter model AND that the user places each task, on both breakpoints', () => {
    // The core model the tour must land: priority comes from urgency × importance, and the USER is
    // the one who places each task there (desktop drag, mobile "Move to quadrant"). Unguarded prose
    // drifts, so pin both axes and the user-places-it link on each breakpoint's board step.
    for (const isMobile of [false, true]) {
      const board = demoTour(isMobile).find((s) => s.title === 'Sorted by what matters')!
      const label = isMobile ? 'mobile' : 'desktop'
      expect(board.body, label).toMatch(/urgent/i)
      expect(board.body, label).toMatch(/import/i)
      expect(board.body, label).toMatch(/\byou\b/i)
      expect(board.body, label).toMatch(/place|placed|drop|drag|move/i)
    }
  })

  it('Plan My Day names the placements AND the context (due/recurring/ongoing) BabyClaw reads', () => {
    // The plan is derived from grid position PLUS each task's context — the explicit ask. Without a
    // guard this rots back into a vague "turns your board into a day," so pin the placement link and
    // all three context signals by name.
    const plan = demoTour(false).find((s) => s.title === 'One tap plans your day')!
    expect(plan.body).toMatch(/where you placed/i)
    expect(plan.body).toMatch(/due/i)
    expect(plan.body).toMatch(/recurr/i)
    expect(plan.body).toMatch(/ongoing/i)
    // Step 4 is a single shared body — the same string serves both breakpoints.
    expect(demoTour(true).find((s) => s.title === 'One tap plans your day')!.body).toBe(plan.body)
  })

  it('teaches the grid decoder ring (↻/❄️) on desktop only — the mobile overview has no badges', () => {
    // The mobile scene is the quadrant overview — none of the grid-card treatments exist there, so
    // no mobile step (body OR bullets) may reference them; the desktop board step must.
    const stepText = (s: ReturnType<typeof demoTour>[number]) =>
      s.body + (s.bullets?.map((b) => `${b.lead} ${b.rest}`).join(' ') ?? '')
    expect(demoTour(true).some((s) => /❄️|↻/.test(stepText(s)))).toBe(false)
    expect(demoTour(false).some((s) => /❄️|↻/.test(stepText(s)))).toBe(true)
  })

  it('sends each breakpoint to where its options actually live', () => {
    // The closing panel is the second breakpoint-switched body, and the riskiest: both breakpoints
    // share the `options` anchor, but it wraps DIFFERENT real chrome (the desktop header's Account
    // nav vs. the real mobile bottom bar) because the real app differs (ADR-0028). Nothing else can
    // catch copy that names the wrong end of the screen — the anchor name is identical, so the
    // step-list test passes either way and the spotlight lands on something either way.
    const closing = (isMobile: boolean) => demoTour(isMobile).at(-1)!
    expect(closing(false).target).toBe('options')
    expect(closing(false).body).toMatch(/along the top/i)
    expect(closing(false).body).not.toMatch(/bottom|“More”/i)

    expect(closing(true).target).toBe('options')
    expect(closing(true).body).toMatch(/along the bottom/i)
    expect(closing(true).body).toMatch(/“More”/)
    expect(closing(true).body).not.toMatch(/along the top/i)
  })

  it('walks the example day in one forward pass, on both breakpoints', () => {
    // Order is load-bearing twice over: it's the narrative (board → what a task is → chat → the
    // plan built from them → the check-ins → habits → the rest), AND FeatureTour scrolls each
    // anchor into view, so this list must stay in DemoScene's DOM order or the page jumps
    // backwards mid-tour. The phone gets one extra panel: the quadrant overview it actually
    // opens on, right after the grid it's an alternative to.
    const middle = [
      'demo-add', // three kinds of task
      'demo-chat-ask', // chat runs the whole app
      'demo-plan', // Plan My Day button + the plan it builds
      'demo-chat-morning',
      'demo-chat-evening',
      'demo-habits',
    ]
    expect(demoTour(false).map((s) => s.target)).toEqual([
      'app-top',
      'demo-grid',
      ...middle,
      'options',
    ])
    expect(demoTour(true).map((s) => s.target)).toEqual([
      'app-top',
      'demo-grid',
      'demo-matrix',
      ...middle,
      'options',
    ])
  })

  it('shows the grid on BOTH breakpoints, and the quadrant overview only on mobile', () => {
    // The phone used to be told about quadrant boxes and never shown the grid its priorities
    // actually live on. Now it leads with the grid too; the overview is the follow-up.
    const titles = (isMobile: boolean) => demoTour(isMobile).map((s) => s.title)
    expect(titles(false)).toContain('Sorted by what matters')
    expect(titles(true)).toContain('Sorted by what matters')
    expect(titles(true)).toContain('Or the quick overview')
    expect(titles(false)).not.toContain('Or the quick overview')
  })

  it('teaches the three kinds on the add UI itself, naming the switch\u2019s own words', () => {
    // The bullets have to match the Type control the panel spotlights (SchedulePanel's
    // Task / Recurring / Ongoing) — a bullet named something else is a caption for a control the
    // user is looking at and can't find.
    for (const isMobile of [false, true]) {
      const step = demoTour(isMobile).find((s) => s.title === 'Three kinds of task')!
      expect(step.target, isMobile ? 'mobile' : 'desktop').toBe('demo-add')
      expect(step.bullets?.map((b) => b.lead)).toEqual(['Task', 'Recurring', 'Ongoing'])
    }
  })

  it('puts \u201Cchat runs the whole app\u201D between the task kinds and Plan My Day', () => {
    for (const isMobile of [false, true]) {
      const order = demoTour(isMobile).map((s) => s.title)
      const kinds = order.indexOf('Three kinds of task')
      const chat = order.indexOf('Chat runs the whole app')
      const plan = order.indexOf('One tap plans your day')
      expect(kinds, isMobile ? 'mobile' : 'desktop').toBeLessThan(chat)
      expect(chat, isMobile ? 'mobile' : 'desktop').toBeLessThan(plan)
    }
  })

  it('Plan My Day stops at \u201Cintelligently plan your day\u201D \u2014 no rock/habit taxonomy', () => {
    // The panel names WHAT BabyClaw reads, not how he sorts it: big rocks / quick wins / habits
    // are plan-card vocabulary a first-run user hasn't met yet.
    const plan = demoTour(false).find((s) => s.title === 'One tap plans your day')!
    expect(plan.body).toMatch(/intelligently plan your day/i)
    expect(plan.body).not.toMatch(/big rock|quick win|small rock|room for habits/i)
  })

  it('rings the bottom-bar tab a panel is about \u2014 mobile only', () => {
    // On a phone the surface and the button that opens it are in different places, so the add and
    // chat panels call out their tab too (FeatureTour's `also`). Desktop's equivalents are in the
    // header nav the closing panel already covers, so nothing rings there.
    const alsoBy = (isMobile: boolean) =>
      Object.fromEntries(demoTour(isMobile).map((s) => [s.title, s.also]))
    const mobile = alsoBy(true)
    expect(mobile['Three kinds of task']).toBe('nav-add')
    expect(mobile['Chat runs the whole app']).toBe('nav-chat')
    // Not the closing panel: it already spotlights the whole bar, so a ring inside that cutout
    // would double-treat an area that isn't dimmed in the first place.
    expect(mobile['Done and Settings']).toBeUndefined()
    expect(demoTour(false).every((s) => s.also === undefined)).toBe(true)
  })

  it('the closing panel is about Done and Settings, not the whole nav', () => {
    for (const isMobile of [false, true]) {
      const closing = demoTour(isMobile).at(-1)!
      const label = isMobile ? 'mobile' : 'desktop'
      expect(closing.title, label).toBe('Done and Settings')
      expect(closing.body, label).toMatch(/\bDone\b/)
      expect(closing.body, label).toMatch(/Settings/)
      // The surfaces that now have panels of their own must not be re-listed here.
      expect(closing.body, label).not.toMatch(/chat|habits/i)
    }
  })
})
