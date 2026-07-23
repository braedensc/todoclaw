import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useGridOnly } from './use-grid-only'

// Same history contract as use-quadrant-focus (whose test this mirrors): entering pushes ONE
// state-flagged entry so the Back gesture exits the mode; ✕/Esc exit through history.back() so
// they stay interchangeable with Back. jsdom's history.back() is async/limited, so these tests
// spy on the history methods and dispatch popstate events directly.

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

describe('useGridOnly', () => {
  it('starts with grid-only off', () => {
    const { result } = renderHook(() => useGridOnly())
    expect(result.current.gridOnly).toBe(false)
  })

  it('enter() turns the mode on and pushes exactly one flagged history entry', () => {
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    expect(result.current.gridOnly).toBe(true)
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(pushSpy.mock.calls[0]?.[0]).toEqual({ tcGridOnly: true })
  })

  it('a second enter() while already on does not stack another entry', () => {
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    act(() => result.current.enter())
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('exit() (✕ / Esc) goes through history.back so Back and ✕ stay interchangeable', () => {
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    act(() => result.current.exit())
    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('popping the grid-only entry (no flag, home hash) leaves the mode', () => {
    window.location.hash = '#/'
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    act(() => fire(null))
    expect(result.current.gridOnly).toBe(false)
  })

  it('popping back ONTO the flagged entry (e.g. Back out of a #/chat deep link) keeps the mode', () => {
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    act(() => fire({ tcGridOnly: true }))
    expect(result.current.gridOnly).toBe(true)
  })

  it('a FORWARD hash navigation (browsers fire popstate for it too) does not exit the mode', () => {
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    window.location.hash = '#/chat'
    act(() => fire(null))
    expect(result.current.gridOnly).toBe(true)
    window.location.hash = ''
  })

  it('entered FROM a #/chat deep link, exit works: the pop lands on the chat entry, not home', () => {
    // The desktop header pill is clickable while a chat deep link is the current entry — the
    // exit detector keys on the RECORDED entry hash, never a hard-coded home hash.
    window.location.hash = '#/chat'
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    act(() => fire(null)) // Back: pops the flagged entry, lands on the '#/chat' entry
    expect(result.current.gridOnly).toBe(false)
    window.location.hash = ''
  })

  it('a pop landing on ANOTHER overlay’s flagged entry (e.g. quadrant focus beneath) exits too', () => {
    window.location.hash = '#/'
    const { result } = renderHook(() => useGridOnly())
    act(() => result.current.enter())
    // Our entry popped; the entry beneath happens to be quadrant focus's (home hash, its flag).
    act(() => fire({ tcQuadrantFocus: true }))
    expect(result.current.gridOnly).toBe(false)
  })
})
