import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MoreSheet } from './MoreSheet'

describe('MoreSheet', () => {
  const handlers = () => ({
    onReminders: vi.fn(),
    onSettings: vi.fn(),
    onSignOut: vi.fn(),
    onClose: vi.fn(),
  })

  it('renders nothing while closed', () => {
    render(<MoreSheet open={false} {...handlers()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the overflow actions when open', () => {
    render(<MoreSheet open {...handlers()} />)
    // Backups moved into Settings → Backups (2026-07-14); the Inbox retired into the Chat drawer
    // (2026-07-14) — so neither is a top-level More item anymore.
    for (const label of ['Daily habits', 'Settings', 'Sign out']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Backups' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inbox' })).toBeNull()
  })

  it('runs the action and closes the sheet on tap', () => {
    const h = handlers()
    render(<MoreSheet open {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(h.onSettings).toHaveBeenCalledTimes(1)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('hides the owner Admin action when onAdmin is not provided', () => {
    render(<MoreSheet open {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull()
  })

  it('shows the Admin action for the owner and runs it', () => {
    const h = handlers()
    const onAdmin = vi.fn()
    render(<MoreSheet open {...h} onAdmin={onAdmin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(onAdmin).toHaveBeenCalledTimes(1)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })
})
