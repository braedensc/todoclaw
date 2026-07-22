import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAppHeight } from './use-app-height'

// jsdom has no visualViewport — install the same controllable fake as use-keyboard-viewport.test.ts
// and drive its resize events. The numbers mirror the iOS 26.5 iPhone-15-Pro-Max measurements the
// hook exists for: standalone launches at 873 (screen minus top inset), settles to 932 (full
// bleed), and the keyboard shrinks the viewport to 519.
let listeners: Set<() => void>
let vv: { height: number }

function setViewport(height: number): void {
  vv.height = height
  act(() => listeners.forEach((cb) => cb()))
}

function appH(): string {
  return document.documentElement.style.getPropertyValue('--app-h')
}

beforeEach(() => {
  listeners = new Set()
  vv = { height: 873 }
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: {
      get height() {
        return vv.height
      },
      addEventListener: (_t: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_t: string, cb: () => void) => listeners.delete(cb),
    },
  })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 430 })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'visualViewport')
  document.documentElement.style.removeProperty('--app-h')
})

describe('useAppHeight', () => {
  it('pins --app-h to the measured viewport on mount', () => {
    renderHook(() => useAppHeight(true))
    expect(appH()).toBe('873px')
  })

  it('follows the standalone 873→932 settle (growth is always real)', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    expect(appH()).toBe('932px')
  })

  it('ignores a keyboard-sized shrink — the shell must stay put behind the keys', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    setViewport(519) // keyboard: 413px shrink, way past the 80px floor
    expect(appH()).toBe('932px')
    setViewport(932) // keyboard dismissed
    expect(appH()).toBe('932px')
  })

  it('adopts a small chrome-sized shrink (the 932→873 web-app state flip)', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    setViewport(873) // 59px: web-app chrome, not a keyboard — the shell must follow or the
    expect(appH()).toBe('873px') // bottom nav hangs below the physical screen again
  })

  it('re-baselines on a width change (rotation), even to a smaller height', () => {
    renderHook(() => useAppHeight(true))
    setViewport(932)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 932 })
    setViewport(430) // landscape: far shorter than 932, but the width changed so it is real
    expect(appH()).toBe('430px')
  })

  it('falls back to innerHeight where visualViewport is unsupported', () => {
    Reflect.deleteProperty(window, 'visualViewport')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
    renderHook(() => useAppHeight(true))
    expect(appH()).toBe('700px')
  })

  it('does nothing while disabled, and removes the var on unmount', () => {
    const { unmount, rerender } = renderHook(({ on }) => useAppHeight(on), {
      initialProps: { on: false },
    })
    expect(appH()).toBe('')
    expect(listeners.size).toBe(0)
    rerender({ on: true })
    expect(appH()).toBe('873px')
    unmount()
    expect(appH()).toBe('')
  })
})
