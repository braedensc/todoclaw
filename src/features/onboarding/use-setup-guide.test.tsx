import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the two dependency seams: the schedule row (account half of the notifications check) and
// the platform/standalone detection from the push hook. localStorage is jsdom's real one — each
// test starts from a cleared store.
const mockSchedule = vi.fn<() => { data?: unknown; isLoading?: boolean }>()
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => mockSchedule(),
}))

const mockPlatform = vi.fn<() => 'ios' | 'macos-safari' | 'other'>()
const mockStandalone = vi.fn<() => boolean>()
vi.mock('../notifications/use-push-subscription', () => ({
  detectApplePlatform: () => mockPlatform(),
  isStandalone: () => mockStandalone(),
}))

import { useSetupGuide } from './use-setup-guide'
import { DISMISSED_KEY, PLAN_DONE_KEY, resetSetupGuide } from './setup-guide-store'

const loadedSchedule = (config: object = {}) => ({
  data: { timezone: 'America/New_York', config },
  isLoading: false,
})

beforeEach(() => {
  localStorage.clear()
  mockSchedule.mockReturnValue(loadedSchedule())
  mockPlatform.mockReturnValue('ios')
  mockStandalone.mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSetupGuide', () => {
  it('shows all three steps, none done, for a fresh iOS device', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(true)
    expect(result.current.stepCount).toBe(3)
    expect(result.current.doneCount).toBe(0)
    expect(result.current.install).toMatchObject({ shown: true, done: false, context: 'ios' })
  })

  it('hides the install step where no install gesture exists (jsdom UA is neither Apple nor Chromium)', () => {
    mockPlatform.mockReturnValue('other')
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.install.shown).toBe(false)
    expect(result.current.stepCount).toBe(2)
  })

  it('dismiss hides the card and persists across mounts', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)

    const remounted = renderHook(() => useSetupGuide(false))
    expect(remounted.result.current.visible).toBe(false)
  })

  it('notifications step needs BOTH the config toggle and the browser permission', () => {
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    const { result, rerender } = renderHook(() => useSetupGuide(false))
    // Config on, but no permission (jsdom has no Notification at all) → not done.
    expect(result.current.notificationsDone).toBe(false)

    vi.stubGlobal('Notification', { permission: 'granted' })
    rerender()
    expect(result.current.notificationsDone).toBe(true)
  })

  it('plan step latches: once a plan has existed, the midnight clear does not regress it', () => {
    const { result, rerender } = renderHook(({ ready }) => useSetupGuide(ready), {
      initialProps: { ready: false },
    })
    expect(result.current.planDone).toBe(false)

    rerender({ ready: true })
    expect(result.current.planDone).toBe(true)
    expect(localStorage.getItem(PLAN_DONE_KEY)).toBe('1')

    rerender({ ready: false })
    expect(result.current.planDone).toBe(true)
  })

  it('auto-dismisses silently for a user who is already fully set up', () => {
    mockStandalone.mockReturnValue(true)
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    vi.stubGlobal('Notification', { permission: 'granted' })
    localStorage.setItem(PLAN_DONE_KEY, '1')

    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1')
  })

  it('stays up in its finished state when the last step completes while open', () => {
    mockStandalone.mockReturnValue(true)
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    vi.stubGlobal('Notification', { permission: 'granted' })

    const { result, rerender } = renderHook(({ ready }) => useSetupGuide(ready), {
      initialProps: { ready: false },
    })
    expect(result.current.visible).toBe(true)
    expect(result.current.allDone).toBe(false)

    rerender({ ready: true })
    expect(result.current.allDone).toBe(true)
    expect(result.current.visible).toBe(true) // seen incomplete → user closes it themselves
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })

  it('resetSetupGuide re-shows a dismissed card without a remount', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)

    act(() => resetSetupGuide())
    expect(result.current.visible).toBe(true)
  })

  it('withholds judgment while the schedule row is still loading', () => {
    mockSchedule.mockReturnValue({ data: undefined, isLoading: true })
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })
})
