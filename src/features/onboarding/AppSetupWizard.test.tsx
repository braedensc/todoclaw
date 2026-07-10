import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// InstallPanels are pure SVG and the wizard no longer pulls in the notifications enabler, but keep
// the client stub as a cheap guard in case a transitive import ever reaches it (it throws without
// env vars, which CI has none of).
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { AppSetupWizard } from './AppSetupWizard'

// The wizard is INSTALL-only now (turning notifications on is its own checklist step). So it never
// shows a notifications button; on Apple it adds a "switch into the app" page.
const baseProps = {
  canPrompt: false,
  onInstallNow: vi.fn(),
  onClose: vi.fn(),
}

describe('AppSetupWizard', () => {
  it('iOS: install page → switch page → done, with no notifications button anywhere', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Done — I’ll finish in the app/ }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('macOS Safari: install (Add to Dock) → switch, no stay-in-browser notifications hatch', () => {
    render(<AppSetupWizard {...baseProps} context="macos-safari" />)
    expect(screen.getByText(/“Add to Dock…”/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText(/sign in once more/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Turn notifications on here instead/ }),
    ).not.toBeInTheDocument()
  })

  it('Chromium: install-only page (with the native prompt when offered) → Done', () => {
    const onInstallNow = vi.fn()
    const onClose = vi.fn()
    render(
      <AppSetupWizard
        {...baseProps}
        context="chromium"
        canPrompt
        onInstallNow={onInstallNow}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install now' }))
    expect(onInstallNow).toHaveBeenCalledOnce()

    // A single page — the primary button is Done, not Next (no notifications page to advance to).
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Escape closes the desktop dialog', () => {
    const onClose = vi.fn()
    render(<AppSetupWizard {...baseProps} context="chromium" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
