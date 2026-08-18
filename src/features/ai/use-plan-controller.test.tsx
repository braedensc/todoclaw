import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DayPlan } from '../../types/plan'
import type { Task } from '../../types/task'

// Stub the data hooks (no network) and the plan mutation we control per test.
const tasksMock = vi.fn()
const updateMutate = vi.fn()
const updateMock = vi.fn()
vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => tasksMock(),
  useUpdateTask: () => updateMock(),
}))
vi.mock('../habits/use-habits', () => ({ useHabits: () => ({ data: [], isLoading: false }) }))

// The check-off writes: the same hooks the grid/list ✓ use.
const markMutate = vi.fn()
const restoreMutate = vi.fn()
const markMock = vi.fn()
const restoreMock = vi.fn()
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => markMock(),
  useRestoreTask: () => restoreMock(),
}))

const dailyMock = vi.fn()
vi.mock('../daily-state/use-daily-state', () => ({ useDailyState: () => dailyMock() }))

const statusMock = vi.fn()
vi.mock('./use-ai-status', () => ({ useAiStatus: () => statusMock() }))

const mutate = vi.fn()
const reset = vi.fn()
const clearMutate = vi.fn()
const planMock = vi.fn()
const clearMock = vi.fn()
const buildPlanRequest = vi.fn(() => ({ built: true }))
vi.mock('./use-plan-my-day', () => ({
  usePlanMyDay: () => planMock(),
  useClearPlan: () => clearMock(),
  buildPlanRequest: () => buildPlanRequest(),
}))

import { usePlanController } from './use-plan-controller'

function task(over: Partial<Task>): Task {
  return {
    id: 'id',
    user_id: 'u1',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

const plan = (headline: string): DayPlan => ({
  headline,
  availableTime: '',
  bigRock: null,
  smallRocks: [],
  habitNote: '',
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  statusMock.mockReturnValue({ data: { paused: false } })
  dailyMock.mockReturnValue({ data: { done: {}, plan: null }, isLoading: false })
  planMock.mockReturnValue({ mutate, reset, isPending: false, isError: false, data: null })
  clearMock.mockReturnValue({ mutate: clearMutate })
  tasksMock.mockReturnValue({ data: [], isLoading: false })
  updateMock.mockReturnValue({ mutate: updateMutate, isPending: false, variables: undefined })
  markMock.mockReturnValue({ mutate: markMutate, isPending: false, variables: undefined })
  restoreMock.mockReturnValue({ mutate: restoreMutate, isPending: false, variables: undefined })
})

describe('usePlanController', () => {
  it('generate() builds the request and fires the mutation when ready', () => {
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.canGenerate).toBe(true)
    result.current.generate()
    expect(buildPlanRequest).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith({ built: true })
  })

  it('does not generate when AI is paused', () => {
    statusMock.mockReturnValue({ data: { paused: true } })
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.paused).toBe(true)
    expect(result.current.canGenerate).toBe(false)
    result.current.generate()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('does not generate while data is still loading', () => {
    dailyMock.mockReturnValue({ data: undefined, isLoading: true })
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.canGenerate).toBe(false)
    result.current.generate()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('hydrates displayPlan from the persisted daily_state.plan when there is no fresh result', () => {
    const persisted = plan('Saved')
    dailyMock.mockReturnValue({ data: { done: {}, plan: persisted }, isLoading: false })
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.displayPlan).toBe(persisted)
  })

  it('prefers the fresh mutation result over the persisted plan', () => {
    const fresh = plan('Fresh')
    planMock.mockReturnValue({ mutate, reset, isPending: false, isError: false, data: fresh })
    dailyMock.mockReturnValue({ data: { done: {}, plan: plan('Saved') }, isLoading: false })
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.displayPlan).toBe(fresh)
  })

  it('clear() resets the fresh result and fires the clear mutation', () => {
    const { result } = renderHook(() => usePlanController('America/New_York'))
    result.current.clear()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(clearMutate).toHaveBeenCalledTimes(1)
  })

  it('collapsed defaults false; toggleCollapsed flips + persists it across a remount (same day)', () => {
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.collapsed).toBe(false)
    act(() => result.current.toggleCollapsed())
    expect(result.current.collapsed).toBe(true)
    // Persisted (device-local, keyed by local date) so a reload restores it — NOT a server delete.
    const remount = renderHook(() => usePlanController('America/New_York'))
    expect(remount.result.current.collapsed).toBe(true)
    // clear()/dismiss is unaffected by collapse — collapse never touches the plan mutation.
    expect(clearMutate).not.toHaveBeenCalled()
  })

  it('a stale collapsed flag from another day is ignored (keyed by local date)', () => {
    localStorage.setItem(
      'tc.planCollapsed',
      JSON.stringify({ date: '1999-01-01', collapsed: true }),
    )
    const { result } = renderHook(() => usePlanController('America/New_York'))
    expect(result.current.collapsed).toBe(false)
  })

  it('generate() clears a lingering collapsed preference so a fresh plan shows expanded', () => {
    const { result } = renderHook(() => usePlanController('America/New_York'))
    act(() => result.current.toggleCollapsed())
    expect(result.current.collapsed).toBe(true)
    act(() => result.current.generate())
    expect(result.current.collapsed).toBe(false)
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})

// Checking an item off IN THE PLAN CARD. The card writes through the very same mutations the grid
// and list ✓ do — that is the whole contract here: one source of truth, so a rock ticked on the
// plan is done everywhere (and shows ticked on the plan when it was done anywhere else).
describe('usePlanController itemCheck', () => {
  const TZ = 'America/New_York'
  const rock = (t: string, taskId: string | null = null) => ({ task: t, taskId })

  it('is null when nothing on the board matches the item (model-invented / deleted since planning)', () => {
    tasksMock.mockReturnValue({ data: [task({ id: 'a', text: 'Real task' })], isLoading: false })
    const { result } = renderHook(() => usePlanController(TZ))
    expect(result.current.itemCheck(rock('Invented thing', 'ghost'))).toBeNull()
  })

  it('checks a normal task off through the shared mark-done write (done map + history)', () => {
    tasksMock.mockReturnValue({
      data: [task({ id: 'a', text: 'File taxes', bucket: 'oneoff' })],
      isLoading: false,
    })
    const { result } = renderHook(() => usePlanController(TZ))
    const check = result.current.itemCheck(rock('File taxes', 'a'))
    expect(check).not.toBeNull()
    act(() => check!.toggle())
    expect(markMutate).toHaveBeenCalledWith({
      taskId: 'a',
      text: 'File taxes',
      bucket: 'oneoff',
      timeZone: TZ,
    })
  })

  it('un-checks a done normal task through restore — the same write the Done tab ↩ makes', () => {
    tasksMock.mockReturnValue({ data: [task({ id: 'a', text: 'File taxes' })], isLoading: false })
    dailyMock.mockReturnValue({ data: { done: { a: true }, plan: null }, isLoading: false })
    const { result } = renderHook(() => usePlanController(TZ))
    expect(result.current.rockDone(rock('File taxes', 'a'))).toBe(true)
    act(() => result.current.itemCheck(rock('File taxes', 'a'))!.toggle())
    expect(restoreMutate).toHaveBeenCalledWith({ taskId: 'a', timeZone: TZ })
    expect(markMutate).not.toHaveBeenCalled()
  })

  it('checks a recurring chore off by advancing its cycle, never through history', () => {
    tasksMock.mockReturnValue({
      data: [
        task({
          id: 'c',
          text: 'Laundry',
          recurring: { frequencyDays: 7, lastDoneAt: '2026-06-01T00:00:00Z', doneCount: 3 },
        }),
      ],
      isLoading: false,
    })
    const { result } = renderHook(() => usePlanController(TZ))
    act(() => result.current.itemCheck(rock('Laundry', 'c'))!.toggle())
    expect(markMutate).not.toHaveBeenCalled()
    const patch = updateMutate.mock.calls[0]?.[0] as {
      id: string
      patch: { recurring: { doneCount: number; lastDoneAt: string; nextDueOn: string | null } }
    }
    expect(patch.id).toBe('c')
    expect(patch.patch.recurring.doneCount).toBe(4)
    expect(patch.patch.recurring.nextDueOn).toBeNull()
    // Stamped at the click, not at render — the "when" of a completion has to be the tap.
    expect(Date.parse(patch.patch.recurring.lastDoneAt)).toBeGreaterThan(Date.parse('2026-06-01'))
  })

  it('un-checks a chore done today by rewinding one cadence (recurring has no un-done record)', () => {
    const lastDoneAt = new Date().toISOString() // done today → the card shows it ticked
    tasksMock.mockReturnValue({
      data: [
        task({
          id: 'c',
          text: 'Laundry',
          recurring: { frequencyDays: 7, lastDoneAt, doneCount: 3 },
        }),
      ],
      isLoading: false,
    })
    const { result } = renderHook(() => usePlanController(TZ))
    expect(result.current.rockDone(rock('Laundry', 'c'))).toBe(true)
    act(() => result.current.itemCheck(rock('Laundry', 'c'))!.toggle())
    const patch = updateMutate.mock.calls[0]?.[0] as {
      patch: { recurring: { doneCount: number; lastDoneAt: string } }
    }
    expect(patch.patch.recurring.doneCount).toBe(2)
    // Seven days back from the completion it undid — so the chore reads due again where it stood.
    expect(Date.parse(lastDoneAt) - Date.parse(patch.patch.recurring.lastDoneAt)).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
    expect(restoreMutate).not.toHaveBeenCalled()
  })

  it('reports the tapped item as busy while its write is in flight (blocks a double-tap)', () => {
    tasksMock.mockReturnValue({
      data: [task({ id: 'a', text: 'File taxes' }), task({ id: 'b', text: 'Book dentist' })],
      isLoading: false,
    })
    markMock.mockReturnValue({ mutate: markMutate, isPending: true, variables: { taskId: 'a' } })
    const { result } = renderHook(() => usePlanController(TZ))
    expect(result.current.itemCheck(rock('File taxes', 'a'))!.busy).toBe(true)
    // Only the row being written to — the rest of the card stays tappable.
    expect(result.current.itemCheck(rock('Book dentist', 'b'))!.busy).toBe(false)
  })

  it('matches a legacy rock with no taskId by exact text, like the strikethrough does', () => {
    tasksMock.mockReturnValue({ data: [task({ id: 'a', text: 'File taxes' })], isLoading: false })
    const { result } = renderHook(() => usePlanController(TZ))
    act(() => result.current.itemCheck(rock('File taxes'))!.toggle())
    expect(markMutate).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'a' }))
  })
})
