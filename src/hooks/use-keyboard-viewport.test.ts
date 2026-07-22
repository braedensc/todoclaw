import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardViewport } from './use-keyboard-viewport'

// jsdom has no visualViewport, so we install a controllable fake and drive its resize/scroll events
// to assert the derived geometry. innerHeight is the (stable) layout viewport. keyboardOpen keys off
// the viewport SHRINK (`innerHeight - vv.height`, scroll-independent); `inset` — the bottom offset
// for a fixed sheet — additionally folds in `offsetTop`, any iOS auto-scroll under the visible band.
const INNER = 800
let listeners: Set<() => void>
let vv: { height: number; offsetTop: number }

function setViewport(height: number, offsetTop = 0): void {
  vv.height = height
  vv.offsetTop = offsetTop
  act(() => listeners.forEach((cb) => cb()))
}

beforeEach(() => {
  listeners = new Set()
  vv = { height: INNER, offsetTop: 0 }
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return vv.height
      },
      get offsetTop() {
        return vv.offsetTop
      },
      addEventListener: (_t: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_t: string, cb: () => void) => listeners.delete(cb),
    },
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
})

describe('useKeyboardViewport', () => {
  it('reports CLOSED (no overlap) while the keyboard is down', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    expect(result.current).toEqual({ inset: 0, height: 800, keyboardOpen: false })
  })

  it('reports the keyboard overlap and the visible height once it opens', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    setViewport(500) // 300px of keyboard
    expect(result.current).toEqual({ inset: 300, height: 500, keyboardOpen: true })
  })

  it('folds iOS auto-scroll (offsetTop) into the inset', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    // Page scrolled up 120px to reveal the focused input; visible band is 500 tall.
    setViewport(500, 120)
    // inset = 800 − 500 − 120 = 180 → the sheet's bottom:180 + height:500 lands its top at 120 (=offsetTop),
    // exactly the top of the visible band, with no separate scroll compensation needed.
    expect(result.current).toEqual({ inset: 180, height: 500, keyboardOpen: true })
  })

  it('stays keyboardOpen when a big iOS auto-scroll drives the inset to ~0', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    // A full-height sheet with a composer near the bottom makes iOS scroll the page ~a keyboard's
    // worth to reveal it: offsetTop 300 with a 300px keyboard → inset = 800 − 500 − 300 = 0. The
    // keyboard is still very much open, so keyboardOpen must NOT flip false (that regressed the
    // re-fit + re-armed swipe-to-dismiss). Detection keys off the 300px viewport shrink, not inset.
    setViewport(500, 300)
    expect(result.current).toEqual({ inset: 0, height: 500, keyboardOpen: true })
  })

  it('treats sub-threshold overlap (URL-bar collapse / rounding) as not-a-keyboard', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    setViewport(760) // 40px overlap, below the 80px floor
    expect(result.current).toEqual({ inset: 40, height: 760, keyboardOpen: false })
  })

  // Installed PWA (display-mode: standalone): iOS shrinks the LAYOUT viewport too, so window
  // .innerHeight drops to the visible band alongside vv.height and `innerHeight - vv.height` collapses
  // to ~0 — the old signal would read "keyboard closed" and never re-fit the sheet (the reporter's
  // bug). Detection keys off the captured keyboard-down baseline instead, so it survives the shrink.
  it('detects the keyboard in a standalone PWA where innerHeight also shrinks', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    // Baseline captured with the keyboard down (innerHeight 800, visible 800).
    expect(result.current.keyboardOpen).toBe(false)
    // Keyboard opens: the layout viewport shrinks in lockstep with the visible band.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 464 })
    setViewport(464)
    // keyboardOpen trips off the 800→464 shrink vs. the baseline (not the ~0 live overlap). inset is
    // ~0 because `fixed` is now relative to the shrunk viewport, so bottom:0 + height fills it.
    expect(result.current).toEqual({ inset: 0, height: 464, keyboardOpen: true })
  })

  it('recovers to closed when the standalone keyboard dismisses and innerHeight restores', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 464 })
    setViewport(464)
    expect(result.current.keyboardOpen).toBe(true)
    // Keyboard down again: both restore to the full layout height.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER })
    setViewport(INNER)
    expect(result.current).toEqual({ inset: 0, height: 800, keyboardOpen: false })
  })

  it('stays CLOSED and binds nothing while disabled', () => {
    const { result } = renderHook(() => useKeyboardViewport(false))
    setViewport(500)
    expect(listeners.size).toBe(0)
    expect(result.current).toEqual({ inset: 0, height: 0, keyboardOpen: false })
  })
})
