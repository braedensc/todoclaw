import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MoreSheet } from './MoreSheet'

describe('MoreSheet', () => {
  const handlers = () => ({
    onSettings: vi.fn(),
    onBackups: vi.fn(),
    onSignOut: vi.fn(),
    onClose: vi.fn(),
  })

  it('renders nothing while closed', () => {
    render(<MoreSheet open={false} {...handlers()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lists the overflow actions when open', () => {
    render(<MoreSheet open {...handlers()} />)
    for (const label of ['Settings', 'Backups', 'Sign out']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('runs the action and closes the sheet on tap', () => {
    const h = handlers()
    render(<MoreSheet open {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(h.onSettings).toHaveBeenCalledTimes(1)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it('hides the owner Invite action when onInvite is not provided', () => {
    render(<MoreSheet open {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Invite someone' })).toBeNull()
  })

  it('shows the Invite action for the owner and runs it', () => {
    const h = handlers()
    const onInvite = vi.fn()
    render(<MoreSheet open {...h} onInvite={onInvite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    expect(onInvite).toHaveBeenCalledTimes(1)
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })
})
