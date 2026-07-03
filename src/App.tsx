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
import { PlanMyDayPanel } from './features/ai/PlanMyDayPanel'
import { ChatPanel } from './features/ai/ChatPanel'
import { BackupsPanel } from './features/backups/BackupsPanel'
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
  const [showPlan, setShowPlan] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
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
      <header className="mb-6 flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-center wide:justify-between">
        <h1 className="font-serif text-2xl font-semibold text-ink wide:text-3xl">Todoclaw</h1>

        <div className="flex flex-wrap items-center gap-2">
          {/* Add-task form: full-width on mobile so the input is comfortably tappable. */}
          <form onSubmit={handleAdd} className="flex w-full gap-2 wide:w-auto">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a task…"
              aria-label="Add a task"
              className="min-w-0 flex-1 rounded border border-border-strong bg-card px-3 py-2 text-sm wide:flex-none"
            />
            <button
              type="submit"
              disabled={addTask.isPending}
              className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Add
            </button>
          </form>

          {/* Action buttons share the row on mobile (flex-1), natural width on desktop. */}
          <button
            type="button"
            onClick={() => setShowPlan(true)}
            className="flex-1 whitespace-nowrap rounded bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 wide:flex-none"
          >
            Plan My Day
          </button>

          <button
            type="button"
            onClick={() => setShowChat((v) => !v)}
            className="flex-1 rounded bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 wide:flex-none"
          >
            Chat
          </button>

          <button
            type="button"
            onClick={() => setShowBackups(true)}
            className="flex-1 rounded border border-border-strong px-4 py-2 text-sm font-medium text-ink hover:bg-panel wide:flex-none"
          >
            Backups
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

      {/* pb clears the fixed mobile bottom bar; the desktop top-nav needs no extra space. */}
      <div className="mt-6 pb-24 wide:pb-0">
        <ActiveView tab={tab} />
      </div>

      {showPlan && (
        <ErrorBoundary>
          <PlanMyDayPanel onClose={() => setShowPlan(false)} />
        </ErrorBoundary>
      )}

      {showChat && (
        <ErrorBoundary>
          <ChatPanel onClose={() => setShowChat(false)} />
        </ErrorBoundary>
      )}

      {showBackups && (
        <ErrorBoundary>
          <BackupsPanel onClose={() => setShowBackups(false)} />
        </ErrorBoundary>
      )}
    </>
  )
}

export default function App() {
  const { session, loading } = useSession()

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6 wide:max-w-[1600px]">
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
