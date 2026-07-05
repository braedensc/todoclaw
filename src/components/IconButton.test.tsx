import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IconButton } from './IconButton'

// jsdom can't evaluate `:hover`, so the variant tests assert the presence of the hover/border
// utility classes (which Tailwind renders from these exact strings) rather than a computed color.

describe('IconButton', () => {
  it('exposes the tooltip (title), accessible name (aria-label), and defaults type=button', () => {
    render(
      <IconButton title="Delete task" aria-label="Delete task">
        ×
      </IconButton>,
    )
    const btn = screen.getByRole('button', { name: 'Delete task' })
    expect(btn).toHaveAttribute('title', 'Delete task')
    expect(btn).toHaveAttribute('type', 'button')
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
