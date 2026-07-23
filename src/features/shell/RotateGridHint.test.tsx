import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { RotateGridHint, ROTATE_HINT_MS } from './RotateGridHint'

// jsdom has neither screen.orientation nor matchMedia — stub both. The stubs pin the CONTRACT:
// the pill listens to screen.orientation (the physical-device signal the iOS keyboard can't
// fake, unlike an orientation media query) and only on coarse-pointer devices.

type Listener = () => void

function stubDevice({ coarse = true, type = 'portrait-primary' } = {}) {
  const listeners = new Set<Listener>()
  const orientation = {
    get type() {
      return current
    },
    addEventListener: (name: string, fn: Listener) => {
      if (name === 'change') listeners.add(fn)
    },
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  let current = type
  let queried: string | null = null
  Object.defineProperty(window.screen, 'orientation', {
    configurable: true,
    get: () => orientation,
  })
  vi.stubGlobal('matchMedia', (q: string) => {
    queried = q
    return { matches: coarse, addEventListener: () => {}, removeEventListener: () => {} }
  })
  return {
    queriedQuery: () => queried,
    rotate: (to: string) => {
      current = to
      listeners.forEach((fn) => fn())
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('RotateGridHint', () => {
  it('shows nothing on mount — even mounted while already landscape (event-only trigger)', () => {
    stubDevice({ type: 'landscape-primary' })
    render(<RotateGridHint onOpenGrid={() => {}} />)
    expect(screen.queryByRole('button', { name: /View grid/ })).toBeNull()
  })

  it('a rotation EVENT to landscape surfaces the pill; tapping it opens grid view', () => {
    const device = stubDevice()
    const onOpenGrid = vi.fn()
    render(<RotateGridHint onOpenGrid={onOpenGrid} />)
    act(() => device.rotate('landscape-primary'))
    fireEvent.click(screen.getByRole('button', { name: /View grid/ }))
    expect(onOpenGrid).toHaveBeenCalledTimes(1)
    expect(device.queriedQuery()).toBe('(pointer: coarse)')
  })

  it('rotating back to portrait dismisses it', () => {
    const device = stubDevice()
    render(<RotateGridHint onOpenGrid={() => {}} />)
    act(() => device.rotate('landscape-secondary'))
    expect(screen.getByRole('button', { name: /View grid/ })).toBeInTheDocument()
    act(() => device.rotate('portrait-primary'))
    expect(screen.queryByRole('button', { name: /View grid/ })).toBeNull()
  })

  it('quietly hides itself after the linger window', () => {
    vi.useFakeTimers()
    const device = stubDevice()
    render(<RotateGridHint onOpenGrid={() => {}} />)
    act(() => device.rotate('landscape-primary'))
    expect(screen.getByRole('button', { name: /View grid/ })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(ROTATE_HINT_MS + 1)
    })
    expect(screen.queryByRole('button', { name: /View grid/ })).toBeNull()
  })

  it('fine-pointer devices (narrow desktop windows) never get the pill', () => {
    const device = stubDevice({ coarse: false })
    render(<RotateGridHint onOpenGrid={() => {}} />)
    act(() => device.rotate('landscape-primary'))
    expect(screen.queryByRole('button', { name: /View grid/ })).toBeNull()
  })
})
