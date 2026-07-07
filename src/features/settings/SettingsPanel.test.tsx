import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// Mock the schedule data hooks (mirrors HabitsView.test) so the panel renders with no Supabase.
// useSaveScheduleConfig is a plain spy we assert the saved payload against.
const scheduleMock = vi.fn()
const saveMutate = vi.fn()

vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => scheduleMock(),
  useSaveScheduleConfig: () => ({ mutate: saveMutate, isPending: false, isError: false }),
}))

// Stub the push hook so the panel test doesn't pull in the real Supabase client (which throws at
// import without env vars) or the browser Push/Notification APIs (absent in jsdom).
vi.mock('../notifications/use-push-subscription', () => ({
  usePushSubscription: () => ({
    supported: true,
    configured: false,
    permission: 'default',
    busy: false,
    error: null,
    iosInstallHint: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.clearAllMocks()
  saveMutate.mockReset() // drop any onSuccess impl a prior test set (clearAllMocks keeps it)
  scheduleMock.mockReturnValue({
    data: { timezone: 'America/New_York', config: {} },
    isLoading: false,
  })
})

describe('SettingsPanel', () => {
  it('renders the schedule + preferences + BabyClaw fields', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('Work start')).toBeInTheDocument()
    expect(screen.getByLabelText('Preferences')).toBeInTheDocument()
    expect(screen.getByLabelText('Tone')).toBeInTheDocument()
    expect(screen.getByLabelText('Custom instructions')).toBeInTheDocument()
  })

  it('caps the freeform fields with a hard maxLength', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByLabelText('Preferences')).toHaveAttribute('maxlength', '500')
    expect(screen.getByLabelText('Custom instructions')).toHaveAttribute('maxlength', '500')
  })

  it('pre-fills fields from the existing config', () => {
    scheduleMock.mockReturnValue({
      data: {
        timezone: 'America/New_York',
        config: { location: 'Atlanta, GA', planNotes: 'Mornings only.' },
      },
      isLoading: false,
    })
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByLabelText('Location')).toHaveValue('Atlanta, GA')
    expect(screen.getByLabelText('Preferences')).toHaveValue('Mornings only.')
  })

  it('saves the edited config with the row timezone and closes on success', () => {
    const onClose = vi.fn()
    saveMutate.mockImplementation((_args, opts) => opts?.onSuccess?.())
    render(<SettingsPanel onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Denver, CO' } })
    fireEvent.change(screen.getByLabelText('Work start'), { target: { value: '9:00' } })
    fireEvent.change(screen.getByLabelText('Preferences'), { target: { value: 'Deep work AM.' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    expect(saveMutate).toHaveBeenCalledTimes(1)
    const [payload] = saveMutate.mock.calls[0]! as [{ timezone: string; config: unknown }]
    expect(payload.timezone).toBe('America/New_York')
    expect(payload.config).toEqual({
      location: 'Denver, CO',
      weekday: { workStart: '9:00' },
      planNotes: 'Deep work AM.',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close when the save does not succeed', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />) // saveMutate never calls onSuccess
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect(saveMutate).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})
