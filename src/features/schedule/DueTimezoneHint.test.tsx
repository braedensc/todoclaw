import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DueTimezoneHint } from './DueTimezoneHint'

// Mock the schedule hook so the component never touches supabase (import-throws in CI)
// and each test controls the stored zone.
let timezone: string | null = null
vi.mock('./use-user-schedule', () => ({
  useUserSchedule: () => ({ data: timezone ? { timezone } : null }),
}))

beforeEach(() => {
  timezone = 'America/New_York'
})

describe('DueTimezoneHint', () => {
  it('renders nothing when the device zone matches the stored zone', () => {
    const { container } = render(<DueTimezoneHint deviceZone="America/New_York" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the schedule row has not loaded', () => {
    timezone = null
    const { container } = render(<DueTimezoneHint deviceZone="Pacific/Auckland" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the stored zone when the device disagrees', () => {
    render(<DueTimezoneHint deviceZone="Pacific/Auckland" />)
    expect(screen.getByText(/times are in new york time/i)).toBeInTheDocument()
  })
})
