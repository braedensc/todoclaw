import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// Mock the three modules that reach supabase (it throws at import without env) so we exercise the
// pure UI. Owner = true; the overview fetch is a mutable hoisted state so each test sets it.
const { overviewState, mutateSpy } = vi.hoisted(() => ({
  overviewState: {
    current: null as unknown as {
      isLoading: boolean
      isError: boolean
      data: unknown
      error: unknown
    },
  },
  mutateSpy: vi.fn(),
}))

vi.mock('../auth/use-is-owner', () => ({ useIsOwner: () => true }))
vi.mock('../settings/InviteManager', () => ({
  InviteManager: () => <div>invite-manager-stub</div>,
}))
vi.mock('../../lib/route', () => ({ goBack: vi.fn() }))
vi.mock('./use-admin', () => ({
  useAdminOverview: () => overviewState.current,
  useSetAdminConfig: () => ({ mutate: mutateSpy, isPending: false, isError: false }),
  formatUsd: (m: number) => `$${(m / 1_000_000).toFixed(2)}`,
  CHAT_MODEL_OPTIONS: ['claude-haiku-4-5', 'claude-sonnet-5'],
  PLAN_MODEL_OPTIONS: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
  MODEL_LABELS: {},
}))

import { AdminPage } from './AdminPage'

const OVERVIEW = {
  config: {
    globalBudgetCapMicros: 60_000_000,
    userBudgetCapMicros: 10_000_000,
    aiBudgetBaseMicros: 10_000_000,
    chatHourLimit: 30,
    chatDayLimit: 100,
    planHourLimit: 10,
    planDayLimit: 10,
    chatModel: 'claude-sonnet-5',
    planModel: 'claude-sonnet-5',
    updatedAt: null,
    updatedBy: null,
  },
  globalSpend: {
    period: '2026-07',
    spentMicros: 6_200_000,
    capMicros: 20_000_000,
    remainingMicros: 13_800_000,
  },
  roster: [
    { user_id: 'abc12345', email: 'braeden@example.com', spent_micros: 6_200_000, updated_at: '' },
  ],
  systemStats: {
    userCount: 3,
    inviteTotal: 5,
    inviteActive: 2,
    redemptionCount: 3,
    pushSubCount: 4,
    lastMessageAt: null,
  },
  integrations: { anthropicKey: true, vapidPublicKey: false },
}

beforeEach(() => {
  overviewState.current = { isLoading: false, isError: false, data: OVERVIEW, error: null }
  mutateSpy.mockReset()
})

describe('AdminPage', () => {
  it('renders the tab bar and defaults to Overview (AI spend)', () => {
    render(<AdminPage />)
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('AI spend this month')).toBeInTheDocument()
    // Overview is NOT showing the Limits reference yet.
    expect(screen.queryByText('Per-IP throttles')).not.toBeInTheDocument()
  })

  it('switches to the Limits tab and shows the grouped, read-only reference', () => {
    render(<AdminPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Limits' }))
    // Group titles across the layers.
    expect(screen.getByText('AI rate limits')).toBeInTheDocument()
    expect(screen.getByText('Per-IP throttles')).toBeInTheDocument()
    expect(screen.getByText('Storage caps (per user)')).toBeInTheDocument()
    expect(screen.getByText('Access & auth model')).toBeInTheDocument()
    // A representative value + the source-of-truth pointer.
    expect(screen.getByText('30/hr · 100/day')).toBeInTheDocument()
    expect(screen.getByText(/docs\/LIMITS\.md/)).toBeInTheDocument()
  })

  it('renders the Limits reference even when the admin overview fetch fails', () => {
    overviewState.current = {
      isLoading: false,
      isError: true,
      data: null,
      error: new Error('boom'),
    }
    render(<AdminPage />)
    // Overview tab surfaces the error…
    expect(screen.getByText(/Couldn’t load the admin overview/)).toBeInTheDocument()
    // …but the static Limits tab is unaffected.
    fireEvent.click(screen.getByRole('tab', { name: 'Limits' }))
    expect(screen.getByText('AI rate limits')).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t load/)).not.toBeInTheDocument()
  })

  it('Guardrails tab: model dropdowns save ONLY the changed keys, Save disabled until dirty', () => {
    render(<AdminPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Guardrails' }))

    const save = screen.getByRole('button', { name: /Save models/ })
    expect(save).toBeDisabled() // nothing changed yet

    // Flip the PLAN model only; the chat model stays untouched and must not ride along.
    fireEvent.change(screen.getByLabelText('Plan model'), {
      target: { value: 'claude-opus-5' },
    })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    expect(mutateSpy).toHaveBeenCalledTimes(1)
    expect(mutateSpy.mock.calls[0]?.[0]).toEqual({ planModel: 'claude-opus-5' })
  })

  it('Guardrails tab: the chat dropdown never offers Opus (per-call clamp math)', () => {
    render(<AdminPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'Guardrails' }))
    const chat = screen.getByLabelText('Chat model') as HTMLSelectElement
    const values = Array.from(chat.options).map((o) => o.value)
    expect(values).toEqual(['claude-haiku-4-5', 'claude-sonnet-5'])
  })

  it('never surfaces a secret value — integrations show status only', () => {
    render(<AdminPage />)
    fireEvent.click(screen.getByRole('tab', { name: 'System' }))
    expect(screen.getByText('Anthropic API key')).toBeInTheDocument()
    expect(screen.getByText('● configured')).toBeInTheDocument()
    expect(screen.getByText('○ not set')).toBeInTheDocument()
  })

  it('shows the owner-only fallback for non-owners', async () => {
    const mod = await import('../auth/use-is-owner')
    vi.spyOn(mod, 'useIsOwner').mockReturnValue(false)
    render(<AdminPage />)
    expect(screen.getByText(/only available to the app owner/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})
