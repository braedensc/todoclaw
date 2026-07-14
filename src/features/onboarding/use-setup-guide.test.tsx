import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the dependency seams: the schedule row (account half of notifications + the tour mirror),
// the task list (plan step's evolving button), and the platform/standalone detection from the push
// hook. localStorage is jsdom's real one — each test starts from a cleared store.
const mockSchedule = vi.fn<() => { data?: unknown; isLoading?: boolean }>()
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => mockSchedule(),
}))

const mockTasks = vi.fn<() => { data?: unknown[]; isLoading?: boolean }>()
vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => mockTasks(),
}))

const mockPlatform = vi.fn<() => 'ios' | 'macos-safari' | 'other'>()
const mockStandalone = vi.fn<() => boolean>()
vi.mock('../notifications/use-push-subscription', () => ({
  detectApplePlatform: () => mockPlatform(),
  isStandalone: () => mockStandalone(),
}))

import { useSetupGuide } from './use-setup-guide'
import {
  DISMISSED_KEY,
  PLAN_DONE_KEY,
  TOUR_DONE_KEY,
  dismissSetupGuide,
  markTourDone,
  resetSetupGuide,
} from './setup-guide-store'

const loadedSchedule = (config: object = {}) => ({
  data: { timezone: 'America/New_York', config },
  isLoading: false,
})

beforeEach(() => {
  // resetSetupGuide sets a session-only module flag (`requested`); dismiss clears it so the
  // forced-show state can't leak between tests.
  dismissSetupGuide()
  localStorage.clear()
  mockSchedule.mockReturnValue(loadedSchedule())
  mockTasks.mockReturnValue({ data: [], isLoading: false })
  mockPlatform.mockReturnValue('ios')
  mockStandalone.mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useSetupGuide', () => {
  it('shows four steps, none done, for a fresh iOS device (install is its own step now)', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(true)
    expect(result.current.stepCount).toBe(4)
    expect(result.current.doneCount).toBe(0)
    expect(result.current.order).toEqual(['tour', 'install', 'notifications', 'plan'])
    expect(result.current.install).toMatchObject({ done: false, context: 'ios' })
  })

  it('drops the install step where no install gesture exists (unknown context → three steps)', () => {
    mockPlatform.mockReturnValue('other')
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.install.context).toBe('unknown')
    expect(result.current.order).toEqual(['tour', 'notifications', 'plan'])
    expect(result.current.stepCount).toBe(3)
  })

  it('chromium: notifications come BEFORE install (install is non-disruptive-last there)', () => {
    mockPlatform.mockReturnValue('other')
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/120' })
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.install.context).toBe('chromium')
    expect(result.current.order).toEqual(['tour', 'notifications', 'install', 'plan'])
    // Chromium can grant notifications in the tab, so the button works right here.
    expect(result.current.canEnableNotificationsHere).toBe(true)
  })

  it('iOS: notifications can’t be enabled until installed (Safari tab has no Notification API)', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.canEnableNotificationsHere).toBe(false)

    mockStandalone.mockReturnValue(true)
    const installed = renderHook(() => useSetupGuide(false))
    expect(installed.result.current.canEnableNotificationsHere).toBe(true)
  })

  it('dismiss hides the card and persists across mounts', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)

    const remounted = renderHook(() => useSetupGuide(false))
    expect(remounted.result.current.visible).toBe(false)
  })

  it('the tour step latches through the store (markTourDone) and reacts live', () => {
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.tourDone).toBe(false)

    act(() => markTourDone())
    expect(result.current.tourDone).toBe(true)
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe('1')
  })

  it('the account mirror (config.onboarding.tourSeen) checks the tour step without any local flag', () => {
    // The #3 fix: a device-independent "seen the tour" fact survives a browser↔PWA storage split.
    mockSchedule.mockReturnValue(loadedSchedule({ onboarding: { tourSeen: true } }))
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.tourDone).toBe(true)
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBeNull() // purely the account half
  })

  it('the notifications step needs BOTH the config toggle and the browser permission', () => {
    mockStandalone.mockReturnValue(true) // installed, so the step is reachable on iOS
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    const { result, rerender } = renderHook(() => useSetupGuide(false))
    // Config on, but no permission (jsdom has no Notification at all) → not done.
    expect(result.current.notificationsDone).toBe(false)

    vi.stubGlobal('Notification', { permission: 'granted' })
    rerender()
    expect(result.current.notificationsDone).toBe(true)
  })

  it('installing checks the install step (its own checkbox now)', () => {
    mockStandalone.mockReturnValue(true)
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.install.done).toBe(true)
    expect(result.current.done.install).toBe(true)
    expect(result.current.notificationsDone).toBe(false)
    expect(result.current.doneCount).toBe(1) // install done; notifications + plan still pending
  })

  it('taskAdded auto-detects an existing task (plan-step button state, not a step of its own)', () => {
    const { result, rerender } = renderHook(() => useSetupGuide(false))
    expect(result.current.taskAdded).toBe(false)
    expect(result.current.stepCount).toBe(4)

    mockTasks.mockReturnValue({ data: [{ id: 't1' }], isLoading: false })
    rerender()
    expect(result.current.taskAdded).toBe(true)
    expect(result.current.doneCount).toBe(0) // a task alone checks nothing — the plan does
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
    mockStandalone.mockReturnValue(true) // install step done
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    vi.stubGlobal('Notification', { permission: 'granted' })
    localStorage.setItem(PLAN_DONE_KEY, '1')
    localStorage.setItem(TOUR_DONE_KEY, '1')

    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1')
  })

  it('stays up in its finished state when the last step completes while open', () => {
    mockStandalone.mockReturnValue(true)
    mockSchedule.mockReturnValue(loadedSchedule({ notifications: { enabled: true } }))
    vi.stubGlobal('Notification', { permission: 'granted' })
    localStorage.setItem(TOUR_DONE_KEY, '1')

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

  it('resetSetupGuide re-shows a dismissed card without a remount, clearing the local latches', () => {
    localStorage.setItem(TOUR_DONE_KEY, '1')
    const { result } = renderHook(() => useSetupGuide(false))
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)

    act(() => resetSetupGuide())
    expect(result.current.visible).toBe(true)
    expect(result.current.tourDone).toBe(false)
  })

  it('shows on the FIRST explicit request even for a fully-set-up user (async tour-mirror clear)', () => {
    // Repro of the two-click bug. A fully-set-up user's tour step reads done via the ACCOUNT mirror
    // (config.onboarding.tourSeen), which Settings' "Show the setup guide" clears with an ASYNC
    // save. On the click's synchronous render every step still reads done, so before the fix the
    // silent auto-dismiss stomped the card and it took a second click. The mirror stays `true`
    // here — the fix must show the card without waiting for the clear to land.
    mockStandalone.mockReturnValue(true) // install done
    mockSchedule.mockReturnValue(
      loadedSchedule({ notifications: { enabled: true }, onboarding: { tourSeen: true } }),
    )
    vi.stubGlobal('Notification', { permission: 'granted' })

    const { result } = renderHook(() => useSetupGuide(true)) // planReady → fully set up
    // Auto-dismissed silently on load (nothing left to do).
    expect(result.current.allDone).toBe(true)
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('1')

    // One explicit request shows it — even though every step still reads done this render.
    act(() => resetSetupGuide())
    expect(result.current.allDone).toBe(true) // mirror still set → nothing flipped it
    expect(result.current.visible).toBe(true)

    // And dismissing ends the forced-show (no eternal card).
    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)
  })

  it('withholds judgment while the schedule row is still loading', () => {
    mockSchedule.mockReturnValue({ data: undefined, isLoading: true })
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })

  it('withholds judgment while the task list is still loading', () => {
    mockTasks.mockReturnValue({ data: undefined, isLoading: true })
    const { result } = renderHook(() => useSetupGuide(false))
    expect(result.current.visible).toBe(false)
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull()
  })
})
