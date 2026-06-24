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
  useDailyState: () => ({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } }),
}))

describe('App shell', () => {
  it('renders the sign-in form when logged out', () => {
    mockSession.mockReturnValue({ session: null, loading: false })
    render(<App />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the tab nav when logged in', () => {
    mockSession.mockReturnValue({ session: { user: { id: 'u1' } }, loading: false })
    render(<App />)
    for (const label of ['Grid', 'List', 'Done', 'Habits']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })
})
