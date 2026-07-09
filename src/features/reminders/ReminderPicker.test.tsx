import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReminderPicker } from './ReminderPicker'

describe('ReminderPicker', () => {
  it('marks the current offset pressed (null = Off)', () => {
    const { rerender } = render(<ReminderPicker value={null} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'false')

    rerender(<ReminderPicker value={60} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('emits the chosen offset in minutes, and null for Off', () => {
    const onChange = vi.fn()
    render(<ReminderPicker value={60} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'At time' }))
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '1 day' }))
    expect(onChange).toHaveBeenLastCalledWith(1440)
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
