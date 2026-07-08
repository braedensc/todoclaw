import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EMPTY_DRAFT } from '../settings/settings-form'

// Live mutable push state the mocked hook returns; each test sets the fields it exercises.
const { pushState } = vi.hoisted(() => ({
  pushState: {
    supported: true,
    configured: true,
    permission: 'default' as NotificationPermission,
    busy: false,
    error: null as string | null,
    applePlatform: 'other' as 'ios' | 'macos-safari' | 'other',
    installed: false,
    setupFailed: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}))

vi.mock('./use-push-subscription', () => ({ usePushSubscription: () => pushState }))

import { NotificationSettings } from './NotificationSettings'

beforeEach(() => {
  Object.assign(pushState, {
    supported: true,
    permission: 'default',
    error: null,
    applePlatform: 'other',
    installed: false,
    setupFailed: false,
  })
})

describe('NotificationSettings', () => {
  it('surfaces the macOS "Add to Dock" web-app tip in Safari when not installed', () => {
    pushState.applePlatform = 'macos-safari'
    render(<NotificationSettings draft={EMPTY_DRAFT} set={vi.fn()} />)
    expect(screen.getByText(/Add to Dock/i)).toBeInTheDocument()
  })

  it('hides the tip once installed as a web app', () => {
    pushState.applePlatform = 'macos-safari'
    pushState.installed = true
    render(<NotificationSettings draft={EMPTY_DRAFT} set={vi.fn()} />)
    expect(screen.queryByText(/Add to Dock/i)).not.toBeInTheDocument()
  })

  it('shows the recovery steps after a push-setup failure', () => {
    pushState.applePlatform = 'macos-safari'
    pushState.setupFailed = true
    render(<NotificationSettings draft={EMPTY_DRAFT} set={vi.fn()} />)
    expect(screen.getByText(/Update macOS to the latest version/i)).toBeInTheDocument()
    expect(screen.getByText(/Location Services/i)).toBeInTheDocument()
    expect(screen.getByText(/Chrome, Edge, and Firefox/i)).toBeInTheDocument()
  })

  it('on iOS in a plain tab (no PushManager), leads with the Home Screen install tip', () => {
    pushState.supported = false
    pushState.applePlatform = 'ios'
    render(<NotificationSettings draft={EMPTY_DRAFT} set={vi.fn()} />)
    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument()
    expect(screen.queryByText(/doesn’t support notifications/i)).not.toBeInTheDocument()
  })
})
