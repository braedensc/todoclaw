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
    created_at: '2026-06-01T00:00:00.000Z',
    deleted_at: null,
    completed_at: null,
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
      text: 'Keep',
      importance: 60, // round(0.6 * 100)
      urgency: 90, // round(0.9 * 100)
      due: '2026-06-26',
      // Delegated to the shared, tz-aware daysUntil (not re-derived here).
      dueInDays: daysUntil('2026-06-26', { timeZone: TZ, now: NOW }),
      dueTime: '15:00:00', // the wall-clock time passes straight through for the plan anchor
    })
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

    expect(req.recurringDue).toEqual([{ text: 'Water', status: 'never done' }])
    expect(req.habits).toEqual(['Stretch'])
    expect(req.dayOfWeek).toBe('Wednesday')
    expect(req.today).toBe('Wednesday, June 24, 2026')
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
