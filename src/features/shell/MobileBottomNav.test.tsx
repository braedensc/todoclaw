import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MobileBottomNav } from './MobileBottomNav'
import type { AppRoute } from '../../lib/route'

describe('MobileBottomNav', () => {
  function setup(route: AppRoute = 'home') {
    const onHome = vi.fn()
    const onAdd = vi.fn()
    const onReminders = vi.fn()
    const onDone = vi.fn()
    const onMore = vi.fn()
    render(
      <MobileBottomNav
        route={route}
        onHome={onHome}
        onAdd={onAdd}
        onReminders={onReminders}
        onDone={onDone}
        onMore={onMore}
      />,
    )
    return { onHome, onAdd, onReminders, onDone, onMore }
  }

  it('exposes Done inside a nav labelled "Account" (the golden openDone contract)', () => {
    setup()
    const nav = screen.getByRole('navigation', { name: 'Account' })
    // Mirrors e2e openDone: getByRole('navigation',{name:'Account'}).getByRole('button',{name:'Done'}).
    expect(within(nav).getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('renders the thumb-zone tabs (incl. Home) and wires each callback', () => {
    const { onHome, onAdd, onReminders, onDone, onMore } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Daily reminders' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onHome).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onReminders).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onMore).toHaveBeenCalledTimes(1)
  })

  it('marks the active route as the current tab', () => {
    setup('done')
    expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('highlights Home when on the home route', () => {
    setup('home')
    expect(screen.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
  })
})
