import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardViewport } from './use-keyboard-viewport'

// jsdom has no visualViewport, so we install a controllable fake and drive its resize/scroll events
// to assert the derived geometry. innerHeight is the (stable) layout viewport; the keyboard eats the
// bottom `innerHeight - vv.height - vv.offsetTop` px, and offsetTop is any iOS auto-scroll of the
// page under the visible band.
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

  it('treats sub-threshold overlap (URL-bar collapse / rounding) as not-a-keyboard', () => {
    const { result } = renderHook(() => useKeyboardViewport(true))
    setViewport(760) // 40px overlap, below the 80px floor
    expect(result.current).toEqual({ inset: 40, height: 760, keyboardOpen: false })
  })

  it('stays CLOSED and binds nothing while disabled', () => {
    const { result } = renderHook(() => useKeyboardViewport(false))
    setViewport(500)
    expect(listeners.size).toBe(0)
    expect(result.current).toEqual({ inset: 0, height: 0, keyboardOpen: false })
  })
})
