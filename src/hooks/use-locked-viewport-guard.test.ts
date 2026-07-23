import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLockedViewportGuard } from './use-locked-viewport-guard'

// Same fake-visualViewport harness as use-keyboard-viewport.test.ts: jsdom has no visualViewport,
// so we install a controllable one and drive its resize events. The guard's other input is the
// window scroll state; jsdom's scrollY is settable via defineProperty and window.scrollTo is
// stubbed to behave like the real thing (reset scrollY, fire a scroll event).
const INNER = 800
let vvListeners: Set<() => void>
let vv: { height: number }
let scrollY: number
let scrollTo: ReturnType<typeof vi.fn>

function fireVvResize(height: number): void {
  vv.height = height
  act(() => vvListeners.forEach((cb) => cb()))
}

function fireWindowScroll(y: number): void {
  scrollY = y
  act(() => window.dispatchEvent(new Event('scroll')))
}

beforeEach(() => {
  vvListeners = new Set()
  vv = { height: INNER }
  scrollY = 0
  scrollTo = vi.fn((_x: number, y: number) => {
    scrollY = y
  })
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return vv.height
      },
      addEventListener: (_t: string, cb: () => void) => vvListeners.add(cb),
      removeEventListener: (_t: string, cb: () => void) => vvListeners.delete(cb),
    },
  })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER })
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollTo })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  Reflect.deleteProperty(window, 'scrollY')
  Reflect.deleteProperty(window, 'scrollTo')
  Reflect.deleteProperty(window, 'innerHeight')
  Reflect.deleteProperty(window, 'innerWidth')
})

describe('useLockedViewportGuard', () => {
  it('snaps a stray window scroll back to 0 while no keyboard is up', () => {
    renderHook(() => useLockedViewportGuard(true))
    fireWindowScroll(48)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('leaves the pan alone while a keyboard is up (iOS revealing the focused field)', () => {
    renderHook(() => useLockedViewportGuard(true))
    fireVvResize(500) // 300px keyboard
    fireWindowScroll(120) // iOS auto-scroll to the caret
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('clears the residue the moment the keyboard closes', () => {
    renderHook(() => useLockedViewportGuard(true))
    fireVvResize(500)
    fireWindowScroll(120) // left over from the focus reveal…
    expect(scrollTo).not.toHaveBeenCalled()
    fireVvResize(INNER) // …keyboard closes, resize fires
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(scrollY).toBe(0)
  })

  it('treats sub-threshold shrink (URL-bar collapse) as no keyboard and still snaps back', () => {
    renderHook(() => useLockedViewportGuard(true))
    fireVvResize(760) // 40px — below the KEYBOARD_MIN_PX floor
    fireWindowScroll(30)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('detects the keyboard in STANDALONE, where innerHeight shrinks with the visual viewport', () => {
    renderHook(() => useLockedViewportGuard(true))
    // Installed-PWA keyboard: iOS shrinks the LAYOUT viewport too, so innerHeight − vv.height
    // reads ~0 — the naive formula sees "no keyboard" and the guard fought the caret-reveal pan
    // on every keystroke. The captured keyboard-down baseline must still detect it.
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 460 })
    fireVvResize(460)
    fireWindowScroll(120) // iOS revealing the caret — must be left alone
    expect(scrollTo).not.toHaveBeenCalled()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: INNER })
    fireVvResize(INNER) // keyboard closes: both heights recover
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('re-baselines on rotation so a shorter landscape height is not read as a keyboard', () => {
    renderHook(() => useLockedViewportGuard(true))
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 420 })
    fireVvResize(420) // landscape: far shorter than the portrait baseline, but width changed too
    fireWindowScroll(30)
    expect(scrollTo).toHaveBeenCalledWith(0, 0) // not a keyboard — residue must still be cleared
  })

  it('does nothing when already at 0 (no scrollTo loop)', () => {
    renderHook(() => useLockedViewportGuard(true))
    fireWindowScroll(0)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('clears pre-existing residue on mount', () => {
    scrollY = 64
    renderHook(() => useLockedViewportGuard(true))
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('binds nothing while disabled (desktop)', () => {
    renderHook(() => useLockedViewportGuard(false))
    expect(vvListeners.size).toBe(0)
    fireWindowScroll(48)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('unbinds on unmount', () => {
    const { unmount } = renderHook(() => useLockedViewportGuard(true))
    unmount()
    expect(vvListeners.size).toBe(0)
    fireWindowScroll(48)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
