import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock the schedule query — this test asserts only the fallback derivation, which is the
// hook's entire job: stored timezone when the row is loaded, the browser zone until then.
const scheduleData = vi.fn<() => { timezone: string } | undefined>()
vi.mock('./use-user-schedule', () => ({
  useUserSchedule: () => ({ data: scheduleData() }),
}))

import { useTimeZone } from './use-time-zone'

describe('useTimeZone', () => {
  it('returns the stored user_schedule timezone once loaded', () => {
    scheduleData.mockReturnValue({ timezone: 'America/Chicago' })
    const { result } = renderHook(() => useTimeZone())
    expect(result.current).toBe('America/Chicago')
  })

  it('falls back to the browser zone while the schedule row is loading', () => {
    scheduleData.mockReturnValue(undefined)
    const { result } = renderHook(() => useTimeZone())
    // The same value useEnsureUserSchedule seeds the row with — fallback and row agree, so
    // "today" never flips when the query resolves.
    expect(result.current).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })
})
