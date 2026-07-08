import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useQuadrantFocus } from './use-quadrant-focus'

// The history contract (mobile audit §4.5): entering a focus list pushes ONE state-flagged entry
// so Back returns to the overview; switching quadrants reuses it; ‹ exits through history.back()
// so the entry is consumed. jsdom's history.back() is async/limited, so these tests spy on the
// history methods and dispatch popstate events directly — the exact signals the hook consumes.

const fire = (state: unknown) => {
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}

let pushSpy: ReturnType<typeof vi.spyOn>
let backSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})
afterEach(() => {
  pushSpy.mockRestore()
  backSpy.mockRestore()
})

describe('useQuadrantFocus', () => {
  it('starts on the overview (focus null)', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    expect(result.current.focus).toBeNull()
  })

  it('enter() focuses the quadrant and pushes exactly one flagged history entry', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('do-now'))
    expect(result.current.focus).toBe('do-now')
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy.mock.calls[0]?.[0]).toEqual({ tcQuadrantFocus: true })
  })

  it('switchTo() (the pager) changes quadrant without stacking another entry', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('do-now'))
    act(() => result.current.switchTo('schedule'))
    expect(result.current.focus).toBe('schedule')
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('exit() (the ‹ button) goes through history.back so Back and ‹ stay interchangeable', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('do-now'))
    act(() => result.current.exit())
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('popping the focus entry (no flag, home hash) returns to the overview', () => {
    window.location.hash = '#/'
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('do-now'))
    act(() => fire(null))
    expect(result.current.focus).toBeNull()
  })

  it('popping back ONTO the focus entry (e.g. Back out of #/done) keeps the focus list', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('errands'))
    act(() => fire({ tcQuadrantFocus: true }))
    expect(result.current.focus).toBe('errands')
  })

  it('a FORWARD hash navigation (browsers fire popstate for it too) does not clear the focus', () => {
    // Tapping the Done tab assigns location.hash = '#/done'; Chrome/WebKit deliver a null-state
    // popstate for that same-document navigation. The focus must survive to be there on Back.
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('schedule'))
    window.location.hash = '#/done'
    act(() => fire(null))
    expect(result.current.focus).toBe('schedule')
    window.location.hash = ''
  })

  it('clear() drops the focus without touching history', () => {
    const { result } = renderHook(() => useQuadrantFocus())
    act(() => result.current.enter('do-now'))
    act(() => result.current.clear())
    expect(result.current.focus).toBeNull()
    expect(backSpy).not.toHaveBeenCalled()
  })
})
