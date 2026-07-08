import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

// BottomSheet is the shared modal sheet the mobile flows open. The tests cover the contract callers
// depend on: it renders only while open, names itself for AT, and dismisses via scrim + Escape but
// NOT via clicks inside — plus the focus contract (focus enters on open, restores on close).

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()} title="Move task">
        <p>body</p>
      </BottomSheet>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('body')).toBeNull()
  })

  it('renders a titled modal dialog with its content when open', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Move task">
        <p>pick a quadrant</p>
      </BottomSheet>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // The visible heading names the dialog (aria-labelledby → the <h2> id).
    expect(screen.getByRole('heading', { name: 'Move task' })).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName('Move task')
    expect(screen.getByText('pick a quadrant')).toBeInTheDocument()
  })

  it('names the dialog via ariaLabel when there is no visible title', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="Add task">
        <h2>Custom heading</h2>
      </BottomSheet>,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Add task')
  })

  it('calls onClose when the scrim is clicked but not when the panel is', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Move task">
        <button type="button">Do Now</button>
      </BottomSheet>,
    )
    // Clicking a control inside the panel must not dismiss.
    fireEvent.click(screen.getByRole('button', { name: 'Do Now' }))
    expect(onClose).not.toHaveBeenCalled()

    // The scrim is the aria-hidden sibling of the dialog; clicking it dismisses.
    const scrim = document.querySelector('.bottom-sheet-scrim') as HTMLElement
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Move task">
        <p>body</p>
      </BottomSheet>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus to initialFocusRef on open and restores it on close', () => {
    const focusRef = createRef<HTMLButtonElement>()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(trigger).toHaveFocus()

    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} title="Move task" initialFocusRef={focusRef}>
        <button ref={focusRef} type="button">
          Do Now
        </button>
      </BottomSheet>,
    )
    expect(screen.getByRole('button', { name: 'Do Now' })).toHaveFocus()

    // Closing restores focus to whatever was focused before it opened.
    rerender(
      <BottomSheet open={false} onClose={vi.fn()} title="Move task" initialFocusRef={focusRef}>
        <button ref={focusRef} type="button">
          Do Now
        </button>
      </BottomSheet>,
    )
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('focuses the panel itself when no initialFocusRef is given', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Move task">
        <p>no focusable content</p>
      </BottomSheet>,
    )
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('fullScreen shows an explicit ✕ Close button that dismisses', () => {
    const onClose = vi.fn()
    render(
      <BottomSheet open onClose={onClose} title="Add a task" fullScreen>
        <p>body</p>
      </BottomSheet>,
    )
    // Still a titled modal dialog…
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Add a task')
    // …but with a header close button instead of relying on the grab-handle/scrim affordance.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the default (card) variant has no Close button', () => {
    render(
      <BottomSheet open onClose={vi.fn()} title="Move task">
        <p>body</p>
      </BottomSheet>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })
})
