import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwipeDismiss } from './use-swipe-dismiss'

// The whole-panel TOUCH path (audit-feedback round): people swipe the sheet body, not the 16px
// handle strip, so the hook binds scroll-aware touch listeners on the panel. These tests pin the
// engagement rules — what starts a sheet drag and what stays native. jsdom has no TouchEvent
// constructor, so plain Events get `touches`/`changedTouches` defined on them; geometry
// (scrollHeight etc.) is stubbed via defineProperty.

// Events carry explicit timestamps: jsdom dispatches micro-seconds apart, which the flick-velocity
// math would read as a violent downward flick (20px / 0.05ms ≫ threshold). `dt` defaults to 100ms
// (well-spaced → slow, sub-flick) so plain drags stay deliberate; the flick tests pass a small dt
// to simulate a fast gesture and assert the distance gate that now guards it.
let clock = 0
function touchEvent(type: string, clientY: number, dt = 100): Event {
  const e = new Event(type, { bubbles: true, cancelable: true })
  const touch = { identifier: 1, clientX: 100, clientY }
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [touch] })
  Object.defineProperty(e, 'changedTouches', { value: [touch] })
  Object.defineProperty(e, 'timeStamp', { value: (clock += dt) })
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

  it('a short, slow drag under the threshold springs back without dismissing', () => {
    const { result } = mount()
    drag(panel, 520, 560, 2) // 40px < 100, at 0.1–0.2 px/ms (100ms event spacing) — no flick
    expect(onDismiss).not.toHaveBeenCalled()
    expect(result.current.offset).toBe(0)
  })

  it('a FAST but short flick does not dismiss — speed alone is not intent ("barely swiped")', () => {
    // The reported bug: a quick little downward nudge (scrolling to re-read a message) closed the
    // sheet. 45px of travel at ~1.25px/ms is well over the velocity bar but under FLICK_MIN_DISTANCE.
    mount()
    act(() => {
      panel.dispatchEvent(touchEvent('touchstart', 520, 0))
      panel.dispatchEvent(touchEvent('touchmove', 540, 10)) // engage (20px > slop), fast
      panel.dispatchEvent(touchEvent('touchmove', 560, 10))
      panel.dispatchEvent(touchEvent('touchend', 565, 10)) // dy 45 < 56 → not a dismiss
    })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('a fast flick that also clears the min distance dismisses', () => {
    mount()
    act(() => {
      panel.dispatchEvent(touchEvent('touchstart', 520, 0))
      panel.dispatchEvent(touchEvent('touchmove', 550, 10))
      panel.dispatchEvent(touchEvent('touchmove', 580, 10))
      panel.dispatchEvent(touchEvent('touchend', 585, 10)) // dy 65 ≥ 56 and fast → dismiss
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
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

// The handle POINTER path (mouse/touch/pen). It's what the chat sheet wires onto its whole header
// band — a region that also carries buttons — so a press on one of those controls must be left for
// the control, while a drag of the handle's own surface still drives the sheet. The hook reads only
// button/clientY/timeStamp/target and calls preventDefault(), so plain objects/Events stand in.
describe('useSwipeDismiss — handle pointer path', () => {
  type PointerHandler = ReturnType<typeof useSwipeDismiss>['onPointerDown']

  function handleDrag(
    onPointerDown: PointerHandler,
    downTarget: Element,
    from: number,
    to: number,
  ) {
    const down = {
      button: 0,
      clientY: from,
      target: downTarget,
      timeStamp: (clock += 100),
      preventDefault: () => {},
    }
    // The hook binds move/up on window; give them clientY + timeStamp (timeStamp is a getter on a
    // real Event, so it must be defineProperty'd, not assigned — same as touchEvent above).
    const winEvent = (type: string): Event => {
      const e = new Event(type)
      Object.defineProperty(e, 'clientY', { value: to })
      Object.defineProperty(e, 'timeStamp', { value: (clock += 100) })
      return e
    }
    act(() => {
      onPointerDown(down as unknown as Parameters<PointerHandler>[0])
      window.dispatchEvent(winEvent('pointermove'))
      window.dispatchEvent(winEvent('pointerup'))
    })
  }

  it('dragging the handle surface past the threshold dismisses', () => {
    const surface = document.createElement('h2') // a title in the header band — not a control
    panel.appendChild(surface)
    const { result } = mount()
    handleDrag(result.current.onPointerDown, surface, 520, 700) // 180px > threshold
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('leaves a press on a header control alone — the button gets its tap, no dismiss', () => {
    const button = document.createElement('button')
    const glyph = document.createElement('span') // a press often lands on the button's inner glyph
    button.appendChild(glyph)
    panel.appendChild(button)
    const { result } = mount()
    // Press the glyph inside the button and pull well past the threshold: the hook bails via
    // closest('button, …'), so the control keeps its own click/focus and the sheet does not dismiss.
    handleDrag(result.current.onPointerDown, glyph, 520, 700)
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
