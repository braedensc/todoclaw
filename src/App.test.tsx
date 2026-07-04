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
// GridView's grid mark-done action calls useMarkTaskDone (Done data layer); stub it so the
// shell renders without a QueryClientProvider / network.
vi.mock('./features/done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: vi.fn() }),
}))
vi.mock('./features/schedule/use-user-schedule', () => ({
  useEnsureUserSchedule: () => ({ mutate: vi.fn() }),
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))
vi.mock('./features/daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {}, plan: null },
  }),
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
  }),
}))
// HabitsView now renders alongside GridView on the Grid tab (no separate Habits tab); stub
// its data layer so the shell renders without a QueryClientProvider / network.
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

  it('renders the Grid/List toggle, the Done link, and the habits section when logged in', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    render(<App />)
    // Grid/List come from the embedded ViewToggle; Done is now a quiet header link (B8).
    for (const label of ['Grid', 'List', 'Done']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument()
    }
    // Habits now render below the work region so they show under both views.
    expect(screen.getByRole('region', { name: 'Habits' })).toBeInTheDocument()
  })
})
