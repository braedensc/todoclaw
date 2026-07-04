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
import { PlanBox } from './features/ai/PlanBox'
import { usePlanController } from './features/ai/use-plan-controller'
import { useTimeZone } from './features/schedule/use-time-zone'
import { ChatPanel } from './features/ai/ChatPanel'
import { BackupsPanel } from './features/backups/BackupsPanel'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { supabase } from './lib/supabase'

// Renders the active tab's view. Lightweight switch — no router (project convention).
// Habits has no tab of its own (parity: eisenclaw.md ~L234-241, pics/Todopic3.jpeg) — it
// renders as a section below the grid, on the same page, whenever Grid is active.
function ActiveView({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'grid':
      return (
        <div className="flex flex-col gap-6">
          <GridView />
          <HabitsView />
        </div>
      )
    case 'list':
      return <ListView />
    case 'done':
      return <DoneView />
  }
}

// The signed-in app shell: header (add-task + Plan My Day stub + sign-out), tab nav, and the
// active view. Kept separate from App so the ensure-schedule effect only runs once a session
// exists. ErrorBoundary wraps the shell in App below.
function AppShell() {
  const [tab, setTab] = useState<Tab>('grid')
  const [text, setText] = useState('')
  const [showChat, setShowChat] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const addTask = useAddTask()
  const ensureSchedule = useEnsureUserSchedule()
  const timeZone = useTimeZone()
  const planner = usePlanController(timeZone)

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
      <header className="mb-6 flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-start wide:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-2xl font-semibold text-ink wide:text-3xl">Todoclaw</h1>
            <button
              type="button"
              onClick={planner.generate}
              disabled={!planner.canGenerate}
              title="Generate a schedule-aware daily plan from your grid, recurring chores, and habits"
              className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              <span aria-hidden>✦</span> {planner.isPending ? 'Thinking…' : 'Plan My Day'}
            </button>
          </div>
          <p className="text-sm text-muted">An AI-powered Eisenhower-matrix-based planner</p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex w-full flex-wrap items-center gap-2 wide:w-auto">
            {/* Add-task form: full-width on mobile so the input is comfortably tappable. */}
            <form onSubmit={handleAdd} className="flex w-full gap-2 wide:w-auto">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a task…"
                aria-label="Add a task"
                className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-2 text-sm wide:flex-none"
              />
              <button
                type="submit"
                disabled={addTask.isPending}
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                Add
              </button>
            </form>

            {/* Chat action. Plan My Day now lives beside the wordmark in the left header block. */}
            <div className="flex flex-1 gap-2 wide:flex-none">
              <button
                type="button"
                onClick={() => setShowChat((v) => !v)}
                className="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 wide:flex-none"
              >
                Chat
              </button>
            </div>
          </div>

          {/* Secondary/utility actions — deliberately smaller and less prominent than the
              AI actions above (Settings + Backups are used far less often). */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="text-sm text-muted underline hover:text-ink"
            >
              <span aria-hidden>⚙</span> Settings
            </button>

            <button
              type="button"
              onClick={() => setShowBackups(true)}
              className="text-sm text-muted underline hover:text-ink"
            >
              <span aria-hidden>↻</span> Backups
            </button>

            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="text-sm text-muted underline hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <TabNav active={tab} onChange={setTab} />

      {/* Plan My Day — a persistent inline card (not a modal): it hydrates from today's
          daily_state.plan, survives reloads, and auto-clears at local midnight. Rendered above
          the tab content for now; a later shell re-layout (B8) reconciles exact placement. */}
      <div className="mt-6">
        <ErrorBoundary>
          <PlanBox
            plan={planner.displayPlan}
            paused={planner.paused}
            isPending={planner.isPending}
            isError={planner.isError}
            onRetry={planner.generate}
          />
        </ErrorBoundary>
      </div>

      {/* pb clears the fixed mobile bottom bar; the desktop top-nav needs no extra space. */}
      <div className="mt-6 pb-24 wide:pb-0">
        <ActiveView tab={tab} />
      </div>

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

      {showSettings && (
        <ErrorBoundary>
          <SettingsPanel onClose={() => setShowSettings(false)} />
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
