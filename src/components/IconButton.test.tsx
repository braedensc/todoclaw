import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { IconButton } from './IconButton'

// jsdom can't evaluate `:hover`, so the variant tests assert the presence of the hover/border
// utility classes (which Tailwind renders from these exact strings) rather than a computed color.

describe('IconButton', () => {
  it('names the button via aria-label, defaults type=button, and does NOT set a native title', () => {
    render(
      <IconButton title="Delete task" aria-label="Delete task">
        ×
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Delete task' })
    // `title` now drives the custom Tooltip, not the native browser tooltip — so it must NOT land
    // on the DOM button (that would resurrect the slow, unstyleable OS tooltip we replaced).
    expect(btn).not.toHaveAttribute('title')
    expect(btn).toHaveAttribute('type', 'button')
  })

  it('shows the custom tooltip on hover (role=tooltip) after the open delay', () => {
    vi.useFakeTimers()
    try {
      render(
        <IconButton title="Delete task" aria-label="Delete task">
          ×
        </IconButton>,
      )
      const btn = screen.getByRole('button', { name: 'Delete task' })
      expect(screen.queryByRole('tooltip')).toBeNull()

      fireEvent.pointerEnter(btn)
      act(() => vi.advanceTimersByTime(200))

      const tip = screen.getByRole('tooltip')
      expect(tip).toHaveTextContent('Delete task')
      // The tooltip describes the control; its name still comes from aria-label.
      expect(btn).toHaveAttribute('aria-describedby', tip.id)

      fireEvent.pointerLeave(btn)
      expect(screen.queryByRole('tooltip')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defaults to the neutral variant (muted → ink on hover)', () => {
    render(
      <IconButton title="Edit" aria-label="Edit">
        ✎
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Edit' })
    expect(btn.className).toContain('border-border-strong')
    expect(btn.className).toContain('hover:text-ink')
  })

  it('applies a green border + green hover for the success variant', () => {
    render(
      <IconButton variant="success" title="Done" aria-label="Done">
        ✓
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Done' })
    expect(btn.className).toContain('border-primary/50')
    expect(btn.className).toContain('hover:border-primary')
    expect(btn.className).toContain('hover:text-primary')
  })

  it('applies a red border + red hover for the danger variant', () => {
    render(
      <IconButton variant="danger" title="Delete" aria-label="Delete">
        ×
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Delete' })
    expect(btn.className).toContain('border-danger/50')
    expect(btn.className).toContain('hover:border-danger')
    expect(btn.className).toContain('hover:text-danger')
  })

  it('forwards onClick and merges an extra className for sizing overrides', () => {
    const onClick = vi.fn()
    render(
      <IconButton title="Go" aria-label="Go" className="h-5 w-5" onClick={onClick}>
        →
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn.className).toContain('h-5 w-5')
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(
      <IconButton title="Go" aria-label="Go" disabled onClick={onClick}>
        →
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })
})
