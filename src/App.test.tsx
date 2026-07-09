import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

// Shell smoke test. We mock every module that would import the real Supabase client
// (src/lib/supabase throws at import when env vars are missing) plus the data hooks, so the
// shell renders under jsdom with no network. The session mock is overridden per test below.
const mockSession = vi.fn<() => { session: unknown; loading: boolean }>()

vi.mock('./features/auth/use-session', () => ({
  useSession: () => mockSession(),
}))
// jsdom has no matchMedia, so the real useIsMobile always reports desktop; this mock lets the
// mobile-presentation tests below flip the breakpoint. Default: desktop.
const mockIsMobile = vi.fn<() => boolean>(() => false)
vi.mock('./hooks/use-is-mobile', () => ({
  useIsMobile: () => mockIsMobile(),
}))
vi.mock('./lib/supabase', () => ({
  supabase: { auth: { signOut: vi.fn(), getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}))
vi.mock('./features/tasks/use-tasks', () => ({
  useAddTask: () => ({ mutate: vi.fn(), isPending: false }),
  // GridView (the default tab) reads/mutates tasks; stub them so the shell renders.
  useTasks: () => ({ data: [] }),
  useUpdateTask: () => ({ mutate: vi.fn() }),
  useSoftDeleteTask: () => ({ mutate: vi.fn() }),
}))
// GridView's grid mark-done action calls useMarkTaskDone; the Done page/sheet reads useHistory +
// its restore/delete mutations (Done data layer). Stub them all so the shell renders (incl. the
// #/done route) without a QueryClientProvider / network.
vi.mock('./features/done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: vi.fn() }),
  useHistory: () => ({ data: [], isLoading: false, isError: false }),
  useRestoreTask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteHistoryEntry: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./features/schedule/use-user-schedule', () => ({
  useEnsureUserSchedule: () => ({ mutate: vi.fn() }),
  // The stored zone is deliberately the HOST's own zone: TimezoneMismatchBanner renders whenever
  // stored ≠ device, and these shell tests must be host-independent — stored == device keeps the
  // banner out of the tree on any machine. (Banner behavior has its own test file.)
  useUserSchedule: () => ({
    data: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, config: {} },
  }),
  useSaveScheduleConfig: () => ({ mutate: vi.fn(), isPending: false }),
}))
// The inbox bell/badge + deep-link seed effect read messages (useQuery/useMutation). Stub them so
// the shell renders without a QueryClientProvider / network.
vi.mock('./features/notifications/use-messages', () => ({
  useMessages: () => ({ data: [], isLoading: false }),
  useUnreadCount: () => 0,
  useMarkMessageRead: () => ({ mutate: vi.fn() }),
}))
vi.mock('./features/daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {}, plan: null },
  }),
}))
// GridView + ListView + the add sheet read/write task reminders (useQuery/useMutation). Stub so
// the shell renders without a QueryClientProvider / network.
vi.mock('./features/reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useUpsertTaskReminder: () => ({ mutate: vi.fn() }),
}))
// The header "Plan My Day" button + inline PlanBox are driven by usePlanController, which reads
// the AI status / plan mutation (useQuery/useMutation). Stub it so the shell renders without a
// QueryClientProvider; PlanBox itself is pure and renders its empty state from displayPlan=null.
vi.mock('./features/ai/use-plan-controller', () => ({
  usePlanController: () => ({
    displayPlan: null,
    paused: false,
    isPending: false,
    isError: false,
    canGenerate: true,
    generate: vi.fn(),
  }),
}))
// The shell instantiates one shared chat controller (useChatController = useAiChat + useAiStatus)
// for the inline BabyClaw reply + the chat popup. useAiStatus uses useQuery, so stub both to keep
// the shell rendering without a QueryClientProvider / network.
vi.mock('./features/ai/use-ai-status', () => ({
  useAiStatus: () => ({ data: { paused: false } }),
}))
vi.mock('./features/ai/use-ai-chat', () => ({
  useAiChat: () => ({
    items: [],
    busy: false,
    pending: null,
    error: null,
    send: vi.fn(),
    confirm: vi.fn(),
    deny: vi.fn(),
    seed: vi.fn(),
  }),
}))
// Daily habits live off the main page now (a gear-area popup + a compact inline name list).
// The inline list reads the habits/daily-state hooks; stub them so the shell renders without a
// QueryClientProvider / network. With no habits, the inline list renders nothing.
vi.mock('./features/habits/use-habits', () => ({
  useHabits: () => ({ data: [], isLoading: false, isError: false }),
  useAddHabit: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateHabit: () => ({ mutate: vi.fn(), isPending: false }),
  useSoftDeleteHabit: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleDailyFlag: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('App shell', () => {
  it('renders the sign-in form when logged out', () => {
    mockSession.mockReturnValue({ session: null, loading: false })
    render(<App />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the Grid/List toggle and the quiet header links (incl. Reminders) when logged in', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    render(<App />)
    // Grid/List come from the embedded ViewToggle; Done + Daily habits are quiet header links.
    // Exact names — 'Grid' must NOT also match the "Grid-only view" header pill.
    for (const label of ['Grid', 'List', 'Done', 'Daily habits']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    // The full reminders popup is closed until the gear-area button is clicked — no dialog yet.
    expect(screen.queryByRole('dialog', { name: 'Daily habits' })).not.toBeInTheDocument()
    // The first-run setup guide shows for a fresh device (nothing dismissed in this jsdom's
    // localStorage; the install step is hidden because jsdom's UA is neither Apple nor Chromium).
    expect(screen.getByRole('region', { name: 'Setup guide' })).toBeInTheDocument()
  })

  it('renders the "Grid-only view" header pill next to Plan My Day', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    render(<App />)
    expect(screen.getByRole('button', { name: 'Grid-only view' })).toBeInTheDocument()
    // Not entered yet — the overlay's Exit control is absent until the pill is clicked.
    expect(screen.queryByRole('button', { name: 'Exit grid-only view' })).not.toBeInTheDocument()
  })

  it('on mobile, #/reminders renders home UNDER the reminders sheet (not a page swap) and locks body scroll', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    mockIsMobile.mockReturnValue(true)
    window.location.hash = '#/reminders'
    try {
      render(<App />)
      // Home stays mounted behind the sheet: the bottom nav (mobile home chrome) is present…
      expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument()
      // …with the reminders sheet (a modal dialog) over it, body scroll locked while it's up.
      expect(screen.getByRole('dialog', { name: 'Daily habits' })).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')
    } finally {
      mockIsMobile.mockReturnValue(false)
      window.location.hash = ''
      document.body.style.overflow = ''
    }
  })

  it('on mobile, #/done renders home UNDER the done sheet (not a page swap) and locks body scroll', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    mockIsMobile.mockReturnValue(true)
    window.location.hash = '#/done'
    try {
      render(<App />)
      // Home stays mounted behind the sheet: the bottom nav (mobile home chrome) is present…
      expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument()
      // …with the Done sheet (a modal dialog named "Done") over it, body scroll locked while up.
      expect(screen.getByRole('dialog', { name: 'Done' })).toBeInTheDocument()
      expect(document.body.style.overflow).toBe('hidden')
    } finally {
      mockIsMobile.mockReturnValue(false)
      window.location.hash = ''
      document.body.style.overflow = ''
    }
  })

  it('on desktop, #/done renders home UNDER a centered Done popup (an overlay, not a page swap)', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    window.location.hash = '#/done'
    try {
      render(<App />)
      // Home stays mounted behind the popup: the Grid/List work area is still present…
      expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument()
      // …with the Done popup (a modal dialog named "Done") over it.
      expect(screen.getByRole('dialog', { name: 'Done' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Done' })).toBeInTheDocument()
    } finally {
      window.location.hash = ''
    }
  })

  it('on desktop, #/reminders opens the habits popup OVER a still-mounted home (not a page swap)', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    window.location.hash = '#/reminders'
    try {
      render(<App />)
      // The setup surface is now a centered popup (a modal dialog) — click the scrim to close it.
      expect(screen.getByRole('dialog', { name: 'Daily habits' })).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Daily habits' })).toBeInTheDocument()
      // Home stays mounted underneath (its work-area view toggle is still present), so you land
      // back on it when the popup closes.
      expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument()
    } finally {
      window.location.hash = ''
    }
  })

  it('on mobile, an open chat locks body scroll behind the sheet', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    mockIsMobile.mockReturnValue(true)
    window.location.hash = '#/chat'
    try {
      render(<App />)
      // Home chrome is behind the sheet and the page can't scroll under it.
      expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument()
      expect(screen.getAllByRole('complementary', { name: 'Chat' }).length).toBeGreaterThan(0)
      expect(document.body.style.overflow).toBe('hidden')
    } finally {
      mockIsMobile.mockReturnValue(false)
      window.location.hash = ''
      document.body.style.overflow = ''
    }
  })

  it('a #/chat deep link renders home UNDER the chat overlay, not a blank shell', () => {
    // The notification-tap landing (ADR-0031): main screen with the drawer open. Regression test
    // for the blank-main-area bug (home content only rendered when route === 'home').
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    window.location.hash = '#/chat/msg-1'
    try {
      render(<App />)
      // Home content is present…
      expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument()
      // …and the chat rail is open: the aside drops aria-hidden when open, so the role query
      // (which excludes aria-hidden elements) only finds Chat asides in the open state.
      expect(screen.getAllByRole('complementary', { name: 'Chat' }).length).toBeGreaterThan(0)
    } finally {
      window.location.hash = ''
    }
  })
})
