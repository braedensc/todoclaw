import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// SafariTroubleshooting reaches src/lib/supabase through NotificationSettings' module graph — it
// THROWS at import without env vars (CI runs with none). Stub the client module.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const mockEnable = vi.fn<() => Promise<boolean>>()
const mockNotif = vi.fn(() => ({
  enable: mockEnable,
  busy: false,
  error: null as string | null,
  setupFailed: false,
  supported: true,
}))
vi.mock('../notifications/use-enable-notifications', () => ({
  useEnableNotifications: () => mockNotif(),
}))

import { AppSetupWizard } from './AppSetupWizard'

const baseProps = {
  installed: false,
  canPrompt: false,
  onInstallNow: vi.fn(),
  onClose: vi.fn(),
}

beforeEach(() => {
  mockEnable.mockReset()
})

describe('AppSetupWizard', () => {
  it('iOS: install page → switch page, and NO notifications button in the tab (it cannot work there)', () => {
    const onClose = vi.fn()
    render(<AppSetupWizard {...baseProps} context="ios" onClose={onClose} />)

    // Page 1: the real button names + the drawn share-sheet.
    expect(screen.getByText(/“Add to Home Screen”/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn on notifications/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // Page 2: the switch-into-the-app story — re-login, BabyClaw comes along, finish inside.
    expect(screen.getByText(/sign in once more/)).toBeInTheDocument()
    expect(screen.getByText(/BabyClaw/)).toBeInTheDocument()
    expect(screen.getByText(/inside the app/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Turn on notifications/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Done — I’ll finish in the app/ }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('macOS Safari: switch page keeps a quiet stay-in-browser escape hatch', () => {
    mockEnable.mockResolvedValue(true)
    render(<AppSetupWizard {...baseProps} context="macos-safari" />)
    expect(screen.getByText(/“Add to Dock…”/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: /Turn notifications on here instead/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
  })

  it('Chromium: install page (with the native prompt when offered) → notifications page', async () => {
    mockEnable.mockResolvedValue(true)
    const onInstallNow = vi.fn()
    render(
      <AppSetupWizard {...baseProps} context="chromium" canPrompt onInstallNow={onInstallNow} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install now' }))
    expect(onInstallNow).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: /Turn on notifications/ }))
    expect(mockEnable).toHaveBeenCalledOnce()
    // Success is confirmed in place.
    expect(await screen.findByText(/Notifications are on for this device/)).toBeInTheDocument()
  })

  it('already installed: goes straight to the notifications page', () => {
    render(<AppSetupWizard {...baseProps} context="ios" installed />)
    expect(screen.getByRole('button', { name: /Turn on notifications/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
  })

  it('Escape closes the desktop dialog', () => {
    const onClose = vi.fn()
    render(<AppSetupWizard {...baseProps} context="chromium" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
