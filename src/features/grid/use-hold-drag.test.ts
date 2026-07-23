import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createRef } from 'react'
import { HOLD_MS, LIFT_OFFSET_PX, useHoldDrag } from './use-hold-drag'

// The hold timer is the whole point of this hook, so fake timers are justified here (the same
// exception as Tooltip/use-local-today). Pointer events dispatch on window, where the hook
// attaches its listeners; the surface rect is stubbed for a real coordinate space.

const onDrop = vi.fn()
const onTap = vi.fn()
const onLift = vi.fn()
const onFrame = vi.fn()
const onLiftEnd = vi.fn()

const surfaceRef = createRef<HTMLDivElement>() as React.MutableRefObject<HTMLDivElement>

function setup() {
  surfaceRef.current = document.createElement('div')
  surfaceRef.current.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0 }) as DOMRect
  return renderHook(() => useHoldDrag({ surfaceRef, onDrop, onTap, onLift, onFrame, onLiftEnd }))
}

// React's synthetic pointer event — only the fields the hook reads.
const press = (x: number, y: number) =>
  ({
    isPrimary: true,
    clientX: x,
    clientY: y,
    preventDefault: () => {},
    stopPropagation: () => {},
  }) as unknown as React.PointerEvent

const winMove = (x: number, y: number) =>
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }))
const winUp = () => window.dispatchEvent(new Event('pointerup'))

beforeEach(() => {
  vi.useFakeTimers()
  onDrop.mockClear()
  onTap.mockClear()
  onLift.mockClear()
  onFrame.mockClear()
  onLiftEnd.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useHoldDrag', () => {
  it('a quick release (before the hold fires) is a tap', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => winUp())
    expect(onTap).toHaveBeenCalledWith('t1')
    expect(onLift).not.toHaveBeenCalled()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('holding past HOLD_MS lifts; moving then releasing drops at the offset-corrected point', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    expect(onLift).toHaveBeenCalledWith('t1')
    expect(result.current.draggingId).toBe('t1')

    act(() => winMove(300, 400 + LIFT_OFFSET_PX)) // chip rides 56px above → lands at y=400
    expect(onFrame).toHaveBeenCalled()
    act(() => winUp())
    expect(onDrop).toHaveBeenCalledTimes(1)
    const [id, point] = onDrop.mock.calls[0] as [string, { x: number; y: number }]
    expect(id).toBe('t1')
    expect(point.x).toBeCloseTo(0.75, 2) // 300/400
    expect(point.y).toBeCloseTo(0.5, 2) // screen y 400/800, inverted
    expect(onLiftEnd).toHaveBeenCalledWith('t1')
    expect(onTap).not.toHaveBeenCalled()
    expect(result.current.draggingId).toBeNull()
  })

  it('a lift released WITHOUT moving is a no-op — no drop, no tap, no position hop', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    act(() => winUp())
    expect(onDrop).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
    expect(onLiftEnd).toHaveBeenCalledWith('t1')
  })

  it('moving past the slop before the hold fires kills the lift AND the tap (dead gesture)', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => winMove(230, 400)) // 30px > HOLD_SLOP_PX
    act(() => vi.advanceTimersByTime(HOLD_MS))
    expect(onLift).not.toHaveBeenCalled()
    act(() => winUp())
    expect(onTap).not.toHaveBeenCalled()
    expect(onDrop).not.toHaveBeenCalled()
  })

  it('pointercancel aborts a lifted drag without writing', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    act(() => winMove(300, 300))
    act(() => window.dispatchEvent(new Event('pointercancel')))
    expect(onDrop).not.toHaveBeenCalled()
    expect(onLiftEnd).toHaveBeenCalledWith('t1')
    expect(result.current.draggingId).toBeNull()
  })

  it('Escape aborts the drag and stops the keypress from propagating (grid-only must not exit)', () => {
    const { result } = setup()
    act(() => result.current.startHold('t1')(press(200, 400)))
    act(() => vi.advanceTimersByTime(HOLD_MS))
    const bubbleListener = vi.fn()
    window.addEventListener('keydown', bubbleListener)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    window.removeEventListener('keydown', bubbleListener)
    expect(onDrop).not.toHaveBeenCalled()
    expect(onLiftEnd).toHaveBeenCalledWith('t1')
    expect(result.current.draggingId).toBeNull()
    expect(bubbleListener).not.toHaveBeenCalled()
  })
})
