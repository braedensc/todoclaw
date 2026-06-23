import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { AuthForm } from './features/auth/AuthForm'
import { useSession } from './features/auth/use-session'
import { useAddTask } from './features/tasks/use-tasks'
import { useEnsureUserSchedule } from './features/schedule/use-user-schedule'
import { GridView } from './features/grid/GridView'
import { ListView } from './features/list/ListView'
import { DoneView } from './features/done/DoneView'
import { HabitsView } from './features/habits/HabitsView'
import { TabNav } from './components/TabNav'
import type { Tab } from './components/tabs'
import { ErrorBoundary } from './components/ErrorBoundary'
import { supabase } from './lib/supabase'

// Renders the active tab's view. Lightweight switch — no router (project convention).
function ActiveView({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'grid':
      return <GridView />
    case 'list':
      return <ListView />
    case 'done':
      return <DoneView />
    case 'habits':
      return <HabitsView />
  }
}

// The signed-in app shell: header (add-task + Plan My Day stub + sign-out), tab nav, and the
// active view. Kept separate from App so the ensure-schedule effect only runs once a session
// exists. ErrorBoundary wraps the shell in App below.
function AppShell() {
  const [tab, setTab] = useState<Tab>('grid')
  const [text, setText] = useState('')
  const addTask = useAddTask()
  const ensureSchedule = useEnsureUserSchedule()

  // Guarantee a user_schedule row exists on first authenticated load — the daily reset
  // depends on its timezone. Idempotent (upsert ignoreDuplicates); runs once on mount.
  const ensure = ensureSchedule.mutate
  useEffect(() => {
    ensure()
  }, [ensure])

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    addTask.mutate(trimmed, { onSuccess: () => setText('') })
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-3xl font-semibold text-ink">Todoclaw</h1>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a task…"
              aria-label="Add a task"
              className="rounded border border-border-strong bg-card px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={addTask.isPending}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Add
            </button>
          </form>

          {/* Plan My Day arrives in Stage 4 — disabled stub holds its place in the layout. */}
          <button
            type="button"
            disabled
            title="Coming in Stage 4"
            className="cursor-not-allowed rounded bg-ink px-4 py-2 text-sm font-medium text-white opacity-50"
          >
            Plan My Day
          </button>

          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="text-sm text-muted underline hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <TabNav active={tab} onChange={setTab} />

      <div className="mt-6">
        <ActiveView tab={tab} />
      </div>
    </>
  )
}

export default function App() {
  const { session, loading } = useSession()

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : session ? (
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      ) : (
        <div className="mx-auto max-w-sm">
          <h1 className="mb-6 font-serif text-3xl font-semibold text-ink">Todoclaw</h1>
          <AuthForm />
        </div>
      )}
    </main>
  )
}
