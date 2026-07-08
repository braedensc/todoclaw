import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwipeDismiss } from './use-swipe-dismiss'

// The whole-panel TOUCH path (audit-feedback round): people swipe the sheet body, not the 16px
// handle strip, so the hook binds scroll-aware touch listeners on the panel. These tests pin the
// engagement rules — what starts a sheet drag and what stays native. jsdom has no TouchEvent
// constructor, so plain Events get `touches`/`changedTouches` defined on them; geometry
// (scrollHeight etc.) is stubbed via defineProperty.

function touchEvent(type: string, clientY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const touch = { identifier: 1, clientX: 100, clientY }
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(e, 'changedTouches', { value: [touch] })
  return e
}

let panel: HTMLDivElement
let onDismiss: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  panel = document.createElement('div')
  document.body.appendChild(panel)
  // The fractional threshold reads the panel height; 300 → threshold = min(120, 100) = 100.
  panel.getBoundingClientRect = () =>
    ({
      height: 300,
      width: 400,
      x: 0,
      y: 500,
      top: 500,
      left: 0,
      right: 400,
      bottom: 800,
    }) as DOMRect
  onDismiss = vi.fn<() => void>()
})
afterEach(() => {
  panel.remove()
})

function mount() {
  return renderHook(() => useSwipeDismiss(onDismiss, { current: panel }, true))
}

function drag(target: Element, from: number, to: number, steps = 4): void {
  act(() => {
    target.dispatchEvent(touchEvent('touchstart', from))
    for (let i = 1; i <= steps; i++) {
      target.dispatchEvent(touchEvent('touchmove', from + ((to - from) * i) / steps))
    }
    target.dispatchEvent(touchEvent('touchend', to))
  })
}

describe('useSwipeDismiss — whole-panel touch path', () => {
  it('a downward body drag past the threshold dismisses', () => {
    const { result } = mount()
    drag(panel, 520, 700) // 180px > min(120, 300/3 = 100)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(result.current.dragging).toBe(false) // settled after release
    expect(result.current.offset).toBe(0)
  })

  it('tracks the finger while dragging (offset + dragging flag)', () => {
    const { result } = mount()
    act(() => {
      panel.dispatchEvent(touchEvent('touchstart', 520))
      panel.dispatchEvent(touchEvent('touchmove', 600))
    })
    expect(result.current.dragging).toBe(true)
    expect(result.current.offset).toBe(80)
    act(() => panel.dispatchEvent(touchEvent('touchend', 600)))
  })

  it('a short drag under the threshold springs back without dismissing', () => {
    const { result } = mount()
    drag(panel, 520, 560, 2) // 40px < 100 — and slow (jsdom timeStamps ~equal → no flick false-positive is the risk; assert no dismiss only if velocity path idle)
    // jsdom gives all events ~the same timeStamp, so dt ≈ 0 → velocity guard (dt > 0) keeps the
    // flick shortcut out of play here.
    expect(onDismiss).not.toHaveBeenCalled()
    expect(result.current.offset).toBe(0)
  })

  it('an upward drag never engages (content scrolls instead)', () => {
    const { result } = mount()
    drag(panel, 520, 400)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(result.current.dragging).toBe(false)
  })

  it('does not engage from inside a scroller that is scrolled down', () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 400 })
    Object.defineProperty(scroller, 'clientHeight', { value: 200 })
    scroller.scrollTop = 50
    const inner = document.createElement('p')
    scroller.appendChild(inner)
    panel.appendChild(scroller)

    mount()
    drag(inner, 520, 700)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('engages from inside a scroller resting at the top (native sheet feel)', () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    Object.defineProperty(scroller, 'scrollHeight', { value: 400 })
    Object.defineProperty(scroller, 'clientHeight', { value: 200 })
    scroller.scrollTop = 0
    const inner = document.createElement('p')
    scroller.appendChild(inner)
    panel.appendChild(scroller)

    mount()
    drag(inner, 520, 700)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('leaves text controls alone (caret/selection stays native)', () => {
    const input = document.createElement('input')
    panel.appendChild(input)
    mount()
    drag(input, 520, 700)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('skips the handle region — the pointer path owns it', () => {
    const handle = document.createElement('div')
    handle.setAttribute('data-sheet-handle', '')
    panel.appendChild(handle)
    mount()
    drag(handle, 520, 700)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('binds nothing while inactive (closed sheet)', () => {
    renderHook(() => useSwipeDismiss(onDismiss, { current: panel }, false))
    drag(panel, 520, 700)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
