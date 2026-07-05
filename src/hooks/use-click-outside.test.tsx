import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useClickOutside } from './use-click-outside'

// A tiny harness: a ref'd "inside" box plus an "outside" sibling, both under document.
function Harness({ onOutside, enabled }: { onOutside: () => void; enabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, onOutside, enabled)
  return (
    <div>
      <div ref={ref} data-testid="inside">
        <button data-testid="child">inner</button>
      </div>
      <button data-testid="outside">outer</button>
    </div>
  )
}

// jsdom's fireEvent doesn't cover pointerdown; dispatch a real PointerEvent-like event.
function pointerDown(el: Element): void {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
}

describe('useClickOutside', () => {
  it('fires when the pointer goes down outside the ref', () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} />)
    pointerDown(screen.getByTestId('outside'))
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('does not fire for a pointerdown inside the ref (including nested children)', () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} />)
    pointerDown(screen.getByTestId('inside'))
    pointerDown(screen.getByTestId('child'))
    expect(onOutside).not.toHaveBeenCalled()
  })

  it('detaches the listener when disabled', () => {
    const onOutside = vi.fn()
    render(<Harness onOutside={onOutside} enabled={false} />)
    pointerDown(screen.getByTestId('outside'))
    expect(onOutside).not.toHaveBeenCalled()
  })
})
