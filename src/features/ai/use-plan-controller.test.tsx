import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { DayPlan } from '../../types/plan'

// Stub the data hooks (no network) and the plan mutation we control per test.
vi.mock('../tasks/use-tasks', () => ({ useTasks: () => ({ data: [], isLoading: false }) }))
vi.mock('../habits/use-habits', () => ({ useHabits: () => ({ data: [], isLoading: false }) }))

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
