import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the three seams: the push hook (device half), the schedule row, and the config save.
const mockSubscribe = vi.fn<() => Promise<boolean>>()
const mockPush = vi.fn(() => ({
  subscribe: mockSubscribe,
  busy: false,
  error: null as string | null,
  setupFailed: false,
  supported: true,
}))
vi.mock('./use-push-subscription', () => ({
  usePushSubscription: () => mockPush(),
}))

const mockScheduleData = vi.fn<() => unknown>()
const mockSave = vi.fn<(input: unknown) => Promise<unknown>>()
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: mockScheduleData(), isLoading: false }),
  useSaveScheduleConfig: () => ({
    mutateAsync: mockSave,
    isPending: false,
    isError: false,
  }),
}))

import { useEnableNotifications } from './use-enable-notifications'

beforeEach(() => {
  mockSubscribe.mockReset()
  mockSave.mockReset().mockResolvedValue({})
  mockScheduleData.mockReturnValue({
    timezone: 'America/New_York',
    config: { location: 'NYC' },
  })
})

describe('useEnableNotifications', () => {
  it('subscribes, then persists enabled=true with the first-enable default hours', async () => {
    mockSubscribe.mockResolvedValue(true)
    const { result } = renderHook(() => useEnableNotifications())

    await expect(result.current.enable()).resolves.toBe(true)
    expect(mockSave).toHaveBeenCalledWith({
      config: {
        location: 'NYC',
        notifications: { enabled: true, morningHour: 8, eveningHour: 21 },
      },
      timezone: 'America/New_York',
    })
  })

  it('keeps hours the user already picked', async () => {
    mockSubscribe.mockResolvedValue(true)
    mockScheduleData.mockReturnValue({
      timezone: 'America/New_York',
      config: { notifications: { morningHour: 6, eveningHour: 22, name: 'B' } },
    })
    const { result } = renderHook(() => useEnableNotifications())

    await result.current.enable()
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          notifications: { enabled: true, morningHour: 6, eveningHour: 22, name: 'B' },
        },
      }),
    )
  })

  it('writes nothing when the device half fails (permission denied / hollow subscription)', async () => {
    mockSubscribe.mockResolvedValue(false)
    const { result } = renderHook(() => useEnableNotifications())

    await expect(result.current.enable()).resolves.toBe(false)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('reports false when the config save fails', async () => {
    mockSubscribe.mockResolvedValue(true)
    mockSave.mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useEnableNotifications())

    await expect(result.current.enable()).resolves.toBe(false)
  })
})
