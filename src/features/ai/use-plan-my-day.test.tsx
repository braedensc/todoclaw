import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Task } from '../../types/task'
import type { Habit } from '../../types/habit'
import { daysUntil } from '../../lib/scoring'

const invoke = vi.fn<(name: string, opts: unknown) => unknown>()
const rpc = vi.fn<(name: string, args: unknown) => unknown>()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    functions: { invoke: (name: string, opts: unknown) => invoke(name, opts) },
    rpc: (name: string, args: unknown) => rpc(name, args),
  },
}))

import { buildPlanRequest, usePlanMyDay, useClearPlan } from './use-plan-my-day'

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't' + Math.random(),
    user_id: 'u1',
    text: 'Task',
    x: 0.8,
    y: 0.7,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h' + Math.random(),
    user_id: 'u1',
    text: 'Habit',
    active: true,
    subtasks: [],
    created_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
    ...over,
  }
}

const NOW = new Date('2026-06-24T12:00:00.000Z') // Wed Jun 24 2026 (08:00 in New York)
const TZ = 'America/New_York'

describe('buildPlanRequest', () => {
  it('keeps only on-grid (non-staged, non-completed, non-done, non-recurring) tasks and maps the axes', () => {
    const onGrid = task({
      id: 'keep',
      text: 'Keep',
      x: 0.9,
      y: 0.6,
      due: '2026-06-26',
      due_time: '15:00:00',
    })
    const tasks = [
      onGrid,
      task({ id: 'staged', staged: true }),
      task({ id: 'done', text: 'Done' }),
      // Completed (permanent completed_at) but NOT in today's done map — must still be excluded so
      // a completed task can't leak back into the AI plan on a fresh day.
      task({ id: 'completed', text: 'Completed', completed_at: '2026-06-23T12:00:00Z' }),
      task({ id: 'rec', recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 } }),
    ]
    const req = buildPlanRequest(tasks, [], { done: true }, TZ, NOW)

    expect(req.tasks).toHaveLength(1)
    expect(req.tasks[0]).toMatchObject({
      id: 'keep', // rides along so the server can tie emitted rocks back to tasks (taskId)
      text: 'Keep',
      importance: 60, // round(0.6 * 100)
      urgency: 90, // round(0.9 * 100)
      due: '2026-06-26',
      // Delegated to the shared, tz-aware daysUntil (not re-derived here).
      dueInDays: daysUntil('2026-06-26', { timeZone: TZ, now: NOW }),
      dueTime: '15:00:00', // the wall-clock time passes straight through for the plan anchor
      size: null, // untagged task → null, so the planner infers effort
    })
  })

  it('includes ONGOING projects (flagged) while still excluding recurring chores', () => {
    const tasks = [
      task({ id: 'proj', text: 'Novel', ongoing: true, x: 0.4, y: 0.8 }),
      task({ id: 'chore', recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 } }),
    ]
    const req = buildPlanRequest(tasks, [], {}, TZ, NOW)
    expect(req.tasks).toHaveLength(1)
    expect(req.tasks[0]).toMatchObject({ text: 'Novel', ongoing: true })
  })

  it('passes a task size through, and defaults an untagged task to null', () => {
    const tasks = [
      task({ id: 'sized', text: 'Big', size: 'L' }),
      task({ id: 'unsized', text: 'Small' }),
    ]
    const req = buildPlanRequest(tasks, [], {}, TZ, NOW)
    const byText = Object.fromEntries(req.tasks.map((t) => [t.text, t.size]))
    expect(byText).toEqual({ Big: 'L', Small: null })
  })

  it('collects dormant tasks un-pausing within the window into `upcoming`, keeping them out of tasks', () => {
    const tasks = [
      task({ id: 'live', text: 'Live', start_date: '2026-06-24' }), // today → live, in tasks
      task({ id: 'soon', text: 'Soon', start_date: '2026-06-25', due: '2026-07-01' }), // +1d → upcoming
      task({ id: 'far', text: 'Far', start_date: '2026-06-30' }), // +6d → dormant but out of window
    ]
    const req = buildPlanRequest(tasks, [], {}, TZ, NOW)
    // Dormant tasks never appear as plannable tasks.
    expect(req.tasks.map((t) => t.text)).toEqual(['Live'])
    // Only the within-window dormant task is a heads-up, carrying its offset + due.
    expect(req.upcoming).toEqual([
      { id: 'soon', text: 'Soon', startsInDays: 1, startDate: '2026-06-25', due: '2026-07-01' },
    ])
  })

  it('surfaces overdue/due/soon recurring chores and active habits, and the local date', () => {
    const tasks = [
      task({
        id: 'overdue',
        text: 'Water',
        recurring: { frequencyDays: 3, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    const habits = [habit({ text: 'Stretch' }), habit({ text: 'Inactive', active: false })]
    const req = buildPlanRequest(tasks, habits, {}, TZ, NOW)

    expect(req.recurringDue).toEqual([
      { id: 'overdue', text: 'Water', status: 'never done', daysLeft: -999 },
    ])
    expect(req.habits).toEqual(['Stretch'])
    expect(req.dayOfWeek).toBe('Wednesday')
    expect(req.today).toBe('Wednesday, June 24, 2026')
  })

  // ---- the reminder ANCHOR is not a deadline ---------------------------------------------------
  // On a recurring chore `due`/`due_time` are the reminder occurrence anchor: nextRecurringFireAt
  // phases the occurrence grid off them and NEVER advances them, so a chore that carries a reminder
  // permanently holds a `due` date receding into the past. Plan selection must therefore key on the
  // cadence alone. A change that read that anchor as a deadline shipped past a green CI once
  // (reverted in #348) precisely because nothing pinned this — these are that pin.
  describe('a recurring chore whose due date is a reminder anchor', () => {
    // Anchored 2026-06-01 09:00 (weeks back, as any live reminder anchor is), weekly, done today.
    const anchored = (over: Partial<Task> = {}) =>
      task({
        id: 'chore',
        text: 'Laundry',
        due: '2026-06-01',
        due_time: '09:00:00',
        recurring: { frequencyDays: 7, lastDoneAt: '2026-06-24T11:00:00Z', doneCount: 9 },
        ...over,
      })

    it('is NOT dragged into the plan by an anchor date far in the past', () => {
      const req = buildPlanRequest([anchored()], [], {}, TZ, NOW)
      expect(req.recurringDue).toEqual([]) // cadence says 7 days out — the anchor must not override
      expect(req.tasks).toEqual([]) // and a chore is never a plannable task
    })

    it('reports the cadence status, never an anchor-derived "overdue Nd"', () => {
      const dueOnCadence = anchored({
        recurring: { frequencyDays: 7, lastDoneAt: '2026-06-17T11:00:00Z', doneCount: 9 },
      })
      const req = buildPlanRequest([dueOnCadence], [], {}, TZ, NOW)
      // 7 days since a weekly chore → due today. If the anchor leaked in it would read
      // "overdue 23d" (2026-06-01 is 23 days before NOW) and climb every day.
      expect(req.recurringDue).toEqual([
        { id: 'chore', text: 'Laundry', status: 'due today', daysLeft: 0 },
      ])
    })

    it('is not hidden by an anchor date in the FUTURE either', () => {
      // The mirror failure: treating the anchor as a deadline would also mute a genuinely
      // overdue chore whose anchor happens to sit ahead of today.
      const overdue = anchored({
        due: '2026-12-25',
        recurring: { frequencyDays: 3, lastDoneAt: '2026-06-19T11:00:00Z', doneCount: 2 },
      })
      const req = buildPlanRequest([overdue], [], {}, TZ, NOW)
      expect(req.recurringDue).toEqual([
        { id: 'chore', text: 'Laundry', status: 'overdue 2d', daysLeft: -2 },
      ])
    })
  })

  // The mechanism that DOES surface a chore on a chosen day (2026-07-29). "I need to do laundry
  // tomorrow" writes recurring.nextDueOn; the plan reads it through the same recurringStatus every
  // other surface uses, so the chore reaches the plan card's "chores due today" strip.
  describe('a recurring chore scheduled onto a specific day', () => {
    // NOW is 2026-06-24T12:00:00Z = 08:00 in New York, so "today" there is the 24th.
    const scheduled = (nextDueOn: string | null) =>
      task({
        id: 'chore',
        text: 'Laundry',
        // Cadence alone = "in 29d" → 'ok' → nowhere near the plan.
        recurring: {
          frequencyDays: 30,
          lastDoneAt: '2026-06-22T11:00:00Z',
          doneCount: 9,
          nextDueOn,
        },
      })

    it('is absent from the plan on the cadence alone', () => {
      expect(buildPlanRequest([scheduled(null)], [], {}, TZ, NOW).recurringDue).toEqual([])
    })

    it('reaches the plan as "due today" on the day it was scheduled for', () => {
      const req = buildPlanRequest([scheduled('2026-06-24')], [], {}, TZ, NOW)
      // daysLeft <= 0 is what deriveChores selects on, so this is the row that lands in the strip.
      expect(req.recurringDue).toEqual([
        { id: 'chore', text: 'Laundry', status: 'due today', daysLeft: 0 },
      ])
      expect(req.tasks).toEqual([]) // still never a plannable rock — a chore is not a rock
    })

    it('is a heads-up, not a chore for today, the day before', () => {
      const req = buildPlanRequest([scheduled('2026-06-25')], [], {}, TZ, NOW)
      expect(req.recurringDue).toEqual([
        { id: 'chore', text: 'Laundry', status: 'due tomorrow', daysLeft: 1 },
      ])
    })

    it('stays out of the plan entirely while the scheduled day is far off', () => {
      expect(buildPlanRequest([scheduled('2026-07-20')], [], {}, TZ, NOW).recurringDue).toEqual([])
    })
  })
})

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const PLAN_RESULT = {
  headline: 'Go',
  availableTime: '~4h',
  bigRock: null,
  smallRocks: [],
  habitNote: 'nice',
}

describe('usePlanMyDay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ error: null })
  })

  it('invokes plan-my-day, returns the plan, and persists it via save_daily_plan', async () => {
    invoke.mockResolvedValue({ data: { plan: PLAN_RESULT }, error: null })
    const { result } = renderHook(() => usePlanMyDay(TZ), { wrapper: wrapper() })

    const body = buildPlanRequest([], [], {}, TZ, NOW)
    result.current.mutate(body)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith('plan-my-day', { body })
    expect(result.current.data).toEqual(PLAN_RESULT)

    // onSuccess persists the plan onto today's daily_state row (local-date keyed).
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    const [fn, arg] = rpc.mock.calls[0] as [string, { p_date: string; p_plan: unknown }]
    expect(fn).toBe('save_daily_plan')
    expect(arg.p_plan).toEqual(PLAN_RESULT)
    expect(arg.p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // The blank-plan-card bug: a truncated emit_plan reached the client as a structurally plausible
  // object with no headline. The old `!data?.plan` truthiness check let it through, so the card
  // rendered empty AND the junk was persisted to daily_state. The response is a boundary — it gets
  // validated like any other.
  it.each([
    ['an empty object', {}],
    ['a plan with no headline', { ...PLAN_RESULT, headline: '' }],
    ['a plan whose headline is only whitespace', { ...PLAN_RESULT, headline: '   ' }],
    ['a contentless shell (the reported shape)', { bigRock: null, smallRocks: [], anchors: [] }],
    ['a missing plan', undefined],
  ])('rejects %s, and persists nothing', async (_label, plan) => {
    invoke.mockResolvedValue({ data: { plan }, error: null })
    const { result } = renderHook(() => usePlanMyDay(TZ), { wrapper: wrapper() })

    result.current.mutate(buildPlanRequest([], [], {}, TZ, NOW))

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(rpc).not.toHaveBeenCalled() // nothing reaches daily_state
  })

  it('still succeeds (plan stays visible) when persistence fails — best effort', async () => {
    invoke.mockResolvedValue({ data: { plan: PLAN_RESULT }, error: null })
    rpc.mockResolvedValue({ error: { message: 'nope' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => usePlanMyDay(TZ), { wrapper: wrapper() })

    result.current.mutate(buildPlanRequest([], [], {}, TZ, NOW))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(PLAN_RESULT)
    await waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })

  it('errors when the function errors and does not persist', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'rate-limited' } })
    const { result } = renderHook(() => usePlanMyDay(TZ), { wrapper: wrapper() })
    result.current.mutate(buildPlanRequest([], [], {}, TZ, NOW))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('useClearPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockResolvedValue({ error: null })
  })

  it('clears today’s plan by writing NULL via save_daily_plan (local-date keyed)', async () => {
    const { result } = renderHook(() => useClearPlan(TZ), { wrapper: wrapper() })
    result.current.mutate()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, arg] = rpc.mock.calls[0] as [string, { p_date: string; p_plan: unknown }]
    expect(fn).toBe('save_daily_plan')
    expect(arg.p_plan).toBeNull()
    expect(arg.p_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('surfaces an error when the clear RPC fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'nope' } })
    const { result } = renderHook(() => useClearPlan(TZ), { wrapper: wrapper() })
    result.current.mutate()
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
