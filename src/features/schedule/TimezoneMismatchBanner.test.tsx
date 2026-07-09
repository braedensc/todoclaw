import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TimezoneMismatchBanner } from './TimezoneMismatchBanner'
import type { UserSchedule } from '../../types/user-schedule'

// Mock the schedule hooks module so the component never touches supabase (which throws on
// import in CI where no VITE_ env exists) and so each test controls the stored zone.
const mutate = vi.fn()
let schedule: UserSchedule | null = null
vi.mock('./use-user-schedule', () => ({
  useUserSchedule: () => ({ data: schedule }),
  useSaveScheduleConfig: () => ({ mutate, isPending: false }),
}))

function makeSchedule(timezone: string): UserSchedule {
  return {
    user_id: 'u',
    timezone,
    config: { location: 'NYC' },
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
  }
}

beforeEach(() => {
  localStorage.clear()
  mutate.mockClear()
  schedule = makeSchedule('America/New_York')
})

describe('TimezoneMismatchBanner', () => {
  it('renders nothing when the device zone matches the stored zone', () => {
    render(<TimezoneMismatchBanner deviceZone="America/New_York" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders nothing while the schedule row has not loaded', () => {
    schedule = null
    render(<TimezoneMismatchBanner deviceZone="Pacific/Auckland" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('names both zones (as readable cities) and states which one tasks follow', () => {
    render(<TimezoneMismatchBanner deviceZone="Pacific/Auckland" />)
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Auckland')
    expect(banner.textContent).toContain('New York') // underscore stripped from the IANA id
    expect(banner.textContent).toContain('follow the Todoclaw timezone')
  })

  it('Switch saves the device zone with the existing config untouched', () => {
    render(<TimezoneMismatchBanner deviceZone="Pacific/Auckland" />)
    fireEvent.click(screen.getByRole('button', { name: /switch to auckland/i }))
    expect(mutate).toHaveBeenCalledWith({
      config: { location: 'NYC' },
      timezone: 'Pacific/Auckland',
    })
  })

  it('Keep dismisses now, stays dismissed on remount, but a NEW mismatch prompts again', () => {
    const first = render(<TimezoneMismatchBanner deviceZone="Pacific/Auckland" />)
    fireEvent.click(screen.getByRole('button', { name: /keep new york/i }))
    expect(screen.queryByRole('status')).toBeNull()

    first.unmount()
    render(<TimezoneMismatchBanner deviceZone="Pacific/Auckland" />)
    expect(screen.queryByRole('status')).toBeNull() // same pair — remembered

    render(<TimezoneMismatchBanner deviceZone="Europe/Berlin" />)
    expect(screen.getByRole('status')).toBeInTheDocument() // different pair — prompt again
  })
})
