import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock the schedule data hooks (mirrors HabitsView.test) so the panel renders with no Supabase.
// useSaveScheduleConfig is a plain spy we assert the saved payload against.
const scheduleMock = vi.fn()
const saveMutate = vi.fn()

vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => scheduleMock(),
  useSaveScheduleConfig: () => ({ mutate: saveMutate, isPending: false, isError: false }),
}))

// The location lookup, as a spy we drive per-test. Mocked for TWO reasons: the real hook needs a
// QueryClient (this panel renders without one), and it imports lib/supabase, which THROWS at import
// when env vars are absent — so leaving it real would pass here and die in CI.
// Default: 'unavailable', the neutral answer that adds nothing to the saved config, so the existing
// payload assertions below stay exact. Tests that care about resolution override it.
const resolveMock = vi.fn()
vi.mock('./use-resolve-location', () => ({ useResolveLocation: () => resolveMock }))

// Stub the live memory list (its own data hooks need a QueryClient + Supabase); it is covered by
// MemoryList.test.tsx. This panel test only exercises the draft fields, not the memory list.
vi.mock('../ai/MemoryList', () => ({ MemoryList: () => null }))
// Backups is live data (its own hooks); stub it to a marker so the tab renders without Supabase.
vi.mock('../backups/BackupsPanel', () => ({ BackupsPanel: () => <div>backups content</div> }))

// Stub the push hook so the panel test doesn't pull in the real Supabase client (which throws at
// import without env vars) or the browser Push/Notification APIs (absent in jsdom).
vi.mock('../notifications/use-push-subscription', () => ({
  usePushSubscription: () => ({
    supported: true,
    configured: false,
    permission: 'default',
    busy: false,
    error: null,
    applePlatform: 'other',
    installed: false,
    setupFailed: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))

import { SettingsPanel } from './SettingsPanel'

beforeEach(() => {
  vi.clearAllMocks()
  saveMutate.mockReset() // drop any onSuccess impl a prior test set (clearAllMocks keeps it)
  resolveMock.mockReset()
  resolveMock.mockResolvedValue({ ok: false, reason: 'unavailable' })
  scheduleMock.mockReturnValue({
    data: { timezone: 'America/New_York', config: {} },
    isLoading: false,
  })
})

describe('SettingsPanel', () => {
  it('renders the schedule + preferences fields on the Plan tab; BabyClaw under the AI tab', () => {
    render(<SettingsPanel onClose={() => {}} />)
    // Plan My Day is the default tab.
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('Work start')).toBeInTheDocument()
    expect(screen.getByLabelText('Preferences')).toBeInTheDocument()
    // BabyClaw tuning lives on the AI tab — absent until it's selected.
    expect(screen.queryByLabelText('Tone')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(screen.getByLabelText('Tone')).toBeInTheDocument()
    expect(screen.getByLabelText('Custom instructions')).toBeInTheDocument()
  })

  it('surfaces Backups under its own tab (moved out of the header/More sheet)', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.queryByText('backups content')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Backups' }))
    expect(screen.getByText('backups content')).toBeInTheDocument()
  })

  it('caps the freeform fields with a hard maxLength', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByLabelText('Preferences')).toHaveAttribute('maxlength', '500')
    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(screen.getByLabelText('Custom instructions')).toHaveAttribute('maxlength', '500')
  })

  it('opens on the Notifications tab when deep-linked, showing the task-reminder default', () => {
    render(<SettingsPanel onClose={() => {}} initialSection="notifications" />)
    const select = screen.getByLabelText('Default reminder for tasks with a time')
    // Unset config → the app default (1 hour before) is pre-selected.
    expect(select).toHaveValue('60')
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

  it('saves the edited config with the row timezone and closes on success', async () => {
    const onClose = vi.fn()
    saveMutate.mockImplementation((_args, opts) => opts?.onSuccess?.())
    render(<SettingsPanel onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Denver, CO' } })
    fireEvent.change(screen.getByLabelText('Work start'), { target: { value: '9:00' } })
    fireEvent.change(screen.getByLabelText('Preferences'), { target: { value: 'Deep work AM.' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    // Awaited: saving an unconfirmed location resolves it first (see handleSave), so the mutate
    // lands a microtask after the click rather than during it.
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1))
    const [payload] = saveMutate.mock.calls[0]! as [{ timezone: string; config: unknown }]
    expect(payload.timezone).toBe('America/New_York')
    expect(payload.config).toEqual({
      location: 'Denver, CO',
      weekday: { workStart: '9:00' },
      planNotes: 'Deep work AM.',
    })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('saves BabyClaw tone + verbosity to config.assistant (one field, two surfaces)', () => {
    // The bug this guards against: the editor used to write `config.babyclaw`, which the server
    // never read. It must write `config.assistant` — the SAME key parseAssistant reads and the
    // set_assistant_preference chat tool writes — using the unified superset vocabulary.
    const onClose = vi.fn()
    saveMutate.mockImplementation((_args, opts) => opts?.onSuccess?.())
    render(<SettingsPanel onClose={onClose} />)

    fireEvent.click(screen.getByRole('tab', { name: 'AI' }))
    fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'direct' } })
    fireEvent.change(screen.getByLabelText('Verbosity'), { target: { value: 'detailed' } })
    fireEvent.change(screen.getByLabelText('Custom instructions'), {
      target: { value: 'Call me Cap.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    const [payload] = saveMutate.mock.calls[0]! as [{ config: { assistant?: unknown } }]
    expect(payload.config.assistant).toEqual({
      tone: 'direct',
      verbosity: 'detailed',
      customInstructions: 'Call me Cap.',
    })
  })

  it('does not close when the save does not succeed', () => {
    const onClose = vi.fn()
    render(<SettingsPanel onClose={onClose} />) // saveMutate never calls onSuccess
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    expect(saveMutate).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })
})

// The location field is free text against wttr.in's own fuzzy geocoder — there's no picker and no
// format to validate against. What makes it usable is the confirmation line: it says what the
// lookup MATCHED, which is the only thing that catches a typo geocoding to a real-but-wrong town.
describe('SettingsPanel — location confirmation', () => {
  const locationInput = () => screen.getByLabelText('Location')

  it('explains the accepted input until there is something to confirm', () => {
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByText('A city, postal code, or airport code.')).toBeInTheDocument()
  })

  it('confirms the matched place on blur', async () => {
    resolveMock.mockResolvedValue({ ok: true, label: 'Denver, Colorado, United States of America' })
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: 'Denver, CO' } })
    fireEvent.blur(locationInput())

    expect(
      await screen.findByText('✓ Denver, Colorado, United States of America'),
    ).toBeInTheDocument()
    expect(resolveMock).toHaveBeenCalledWith('Denver, CO')
  })

  it('shows a stored confirmation on open, without re-resolving', () => {
    // The point of persisting the label: reopening Settings tells you what location is actually
    // set, rather than showing a bare string you have to trust.
    scheduleMock.mockReturnValue({
      data: {
        timezone: 'America/New_York',
        config: { location: 'Portland, OR', locationResolved: 'Portland, Oregon, United States' },
      },
      isLoading: false,
    })
    render(<SettingsPanel onClose={() => {}} />)
    expect(screen.getByText('✓ Portland, Oregon, United States')).toBeInTheDocument()
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('surfaces a typo that geocodes to a real but wrong town', async () => {
    // wttr.in answers HTTP 200 for `Portlnad, OR` with weather for Roberts, Oregon. Nothing else in
    // the app can catch this — the plan would just quietly describe the wrong place.
    resolveMock.mockResolvedValue({ ok: true, label: 'Roberts, Oregon, United States of America' })
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: 'Portlnad, OR' } })
    fireEvent.blur(locationInput())

    expect(
      await screen.findByText('✓ Roberts, Oregon, United States of America'),
    ).toBeInTheDocument()
  })

  it('retires the confirmation the moment the location is edited', async () => {
    resolveMock.mockResolvedValue({ ok: true, label: 'Denver, Colorado, United States of America' })
    render(<SettingsPanel onClose={() => {}} />)
    fireEvent.change(locationInput(), { target: { value: 'Denver, CO' } })
    fireEvent.blur(locationInput())
    await screen.findByText('✓ Denver, Colorado, United States of America')

    fireEvent.change(locationInput(), { target: { value: 'Denver, C' } })

    // A stale label describing a place you've typed past is worse than no label at all.
    expect(screen.queryByText(/Denver, Colorado/)).not.toBeInTheDocument()
    expect(screen.getByText('A city, postal code, or airport code.')).toBeInTheDocument()
  })

  it('says so when the place cannot be found, and still saves the location', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'not_found' })
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: 'asdfqwerzxcv' } })
    fireEvent.blur(locationInput())
    expect(
      await screen.findByText("We couldn't find that — your daily plan will skip the weather."),
    ).toBeInTheDocument()

    // Never block the save: someone may live somewhere wttr.in doesn't know, and weather is
    // optional context by design.
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1))
    const [payload] = saveMutate.mock.calls[0]! as [{ config: Record<string, unknown> }]
    expect(payload.config).toEqual({ location: 'asdfqwerzxcv' })
  })

  it('distinguishes a lookup outage from an unknown place', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'unavailable' })
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: 'Denver, CO' } })
    fireEvent.blur(locationInput())

    // Our lookup failing must never read as "your city doesn't exist".
    expect(
      await screen.findByText("Couldn't check that just now — your location is still saved."),
    ).toBeInTheDocument()
  })

  it('resolves before saving when the field was never blurred', async () => {
    // The race this closes: clicking Save blurs the field, but the click lands before the blur's
    // lookup returns — so without a resolve in handleSave the label would never persist and the
    // user would reopen Settings to an unconfirmed field.
    resolveMock.mockResolvedValue({ ok: true, label: 'Denver, Colorado, United States of America' })
    saveMutate.mockImplementation((_args, opts) => opts?.onSuccess?.())
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: 'Denver, CO' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i })) // no blur first

    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1))
    const [payload] = saveMutate.mock.calls[0]! as [{ config: Record<string, unknown> }]
    expect(payload.config).toEqual({
      location: 'Denver, CO',
      locationResolved: 'Denver, Colorado, United States of America',
    })
  })

  it('drops a stored confirmation when the location is cleared', async () => {
    scheduleMock.mockReturnValue({
      data: {
        timezone: 'America/New_York',
        config: { location: 'Portland, OR', locationResolved: 'Portland, Oregon, United States' },
      },
      isLoading: false,
    })
    render(<SettingsPanel onClose={() => {}} />)

    fireEvent.change(locationInput(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }))

    // A label with no location to describe is orphaned state.
    await waitFor(() => expect(saveMutate).toHaveBeenCalledTimes(1))
    const [payload] = saveMutate.mock.calls[0]! as [{ config: Record<string, unknown> }]
    expect(payload.config).toEqual({})
  })
})
