import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useBackgroundDismiss, BACKGROUND_DISMISS_ATTR } from './use-background-dismiss'

// A stand-in for the real layout: a marked background surface with an unmarked card sitting ON it
// (the grid canvas / GridCard relationship) plus an unmarked control elsewhere (the add-task
// widget, settings, …). The whole point of the rule is which of these dismiss and which don't.
function Harness({ onDismiss, enabled = true }: { onDismiss: () => void; enabled?: boolean }) {
  useBackgroundDismiss(onDismiss, enabled)
  return (
    <div>
      <div {...{ [BACKGROUND_DISMISS_ATTR]: true }} data-testid="canvas">
        <div data-testid="card">
          <span data-testid="card-text">Ship the deck</span>
        </div>
      </div>
      <button data-testid="control">Add task</button>
    </div>
  )
}

const press = (el: Element, init: object = {}) => fireEvent.pointerDown(el, { button: 0, ...init })

describe('useBackgroundDismiss', () => {
  const onDismiss = vi.fn()
  beforeEach(() => onDismiss.mockReset())

  it('dismisses when a marked background surface is pressed', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />)
    press(getByTestId('canvas'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does NOT dismiss when a card sitting on that background is pressed', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />)
    press(getByTestId('card'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // The match is on the pressed element exactly — never an ancestor. A press on text INSIDE a card
  // must not walk up to the canvas and count as background, or every drag would close the panel.
  it('does NOT dismiss when a descendant deep inside a card is pressed', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />)
    press(getByTestId('card-text'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does NOT dismiss when an unmarked control elsewhere is pressed', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />)
    press(getByTestId('control'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('ignores a non-primary button (a right-click opens a menu; it must not yank the panel shut)', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} />)
    press(getByTestId('canvas'), { button: 2 })
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('detaches while disabled', () => {
    const { getByTestId } = render(<Harness onDismiss={onDismiss} enabled={false} />)
    press(getByTestId('canvas'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', () => {
    const { getByTestId, unmount } = render(<Harness onDismiss={onDismiss} />)
    const canvas = getByTestId('canvas')
    unmount()
    press(canvas)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  // A child that stops propagation shouldn't be able to swallow the dismissal — hence capture phase.
  it('still dismisses when a background press is stopped from propagating', () => {
    function Stopper() {
      useBackgroundDismiss(onDismiss)
      return (
        <div
          {...{ [BACKGROUND_DISMISS_ATTR]: true }}
          data-testid="canvas"
          onPointerDown={(e) => e.stopPropagation()}
        />
      )
    }
    const { getByTestId } = render(<Stopper />)
    press(getByTestId('canvas'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
