import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLocalToday } from './use-local-today'

// The LIVE local-date hook behind useDailyState's query key. The stakes: an app left open
// overnight must flip to the new (empty) daily_state day on its own — that's what makes habits
// visibly reset each morning. Fake timers drive the 60s tick across a midnight boundary.

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useLocalToday', () => {
  it("returns the given zone's calendar date, not the browser/UTC one", () => {
    // 02:00 UTC on the 9th is still the evening of the 8th in New York.
    vi.setSystemTime(new Date('2026-07-09T02:00:00Z'))
    const { result } = renderHook(() => useLocalToday('America/New_York'))
    expect(result.current).toBe('2026-07-08')
  })

  it('flips to the new date on its own when local midnight passes (60s tick)', () => {
    vi.setSystemTime(new Date('2026-07-08T23:59:30Z'))
    const { result } = renderHook(() => useLocalToday('UTC'))
    expect(result.current).toBe('2026-07-08')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toBe('2026-07-09')
  })

  it('recomputes immediately when the app is foregrounded (visibilitychange)', () => {
    vi.setSystemTime(new Date('2026-07-08T23:59:30Z'))
    const { result } = renderHook(() => useLocalToday('UTC'))
    expect(result.current).toBe('2026-07-08')

    // Cross midnight while "backgrounded" (no tick delivered), then fire the foreground event —
    // the real morning case: mobile browsers suspend timers, the visibility event is what lands.
    vi.setSystemTime(new Date('2026-07-09T07:00:00Z'))
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-07-09')
  })

  it('recomputes when the timezone changes', () => {
    vi.setSystemTime(new Date('2026-07-09T02:00:00Z'))
    const { result, rerender } = renderHook(({ tz }) => useLocalToday(tz), {
      initialProps: { tz: 'America/New_York' },
    })
    expect(result.current).toBe('2026-07-08')

    rerender({ tz: 'UTC' })
    expect(result.current).toBe('2026-07-09')
  })
})
