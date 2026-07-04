import { useEffect, useState } from 'react'
import { AuthForm } from './features/auth/AuthForm'
import { useSession } from './features/auth/use-session'
import { useEnsureUserSchedule } from './features/schedule/use-user-schedule'
import { HabitsView } from './features/habits/HabitsView'
import { WorkArea } from './features/shell/WorkArea'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PlanBox } from './features/ai/PlanBox'
import { usePlanController } from './features/ai/use-plan-controller'
import { useChatController } from './features/ai/use-chat-controller'
import { useTimeZone } from './features/schedule/use-time-zone'
import { ChatPanel } from './features/ai/ChatPanel'
import { BackupsPanel } from './features/backups/BackupsPanel'
import { DonePanel } from './features/done/DonePanel'
import { supabase } from './lib/supabase'

// The signed-in app shell (B8 layout): header (wordmark + Plan My Day + quiet Done/Backups/Sign
// out links), the persistent Plan card top-center, the work region (one input widget + the Grid⇄
// List swap with its embedded toggle), and the daily-habits strip below both views. Kept separate
// from App so the ensure-schedule effect only runs once a session exists.
function AppShell() {
  const [showChat, setShowChat] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const ensureSchedule = useEnsureUserSchedule()
  const timeZone = useTimeZone()
  const planner = usePlanController(timeZone)
  // One conversation for the whole shell — shared by the inline BabyClaw reply and the chat popup.
  const chat = useChatController()

  // Guarantee a user_schedule row exists on first authenticated load — the daily reset depends on
  // its timezone. Idempotent (upsert ignoreDuplicates); runs once on mount.
  const ensure = ensureSchedule.mutate
  useEffect(() => {
    ensure()
  }, [ensure])

  return (
    <>
      <header className="mb-5 flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-start wide:justify-between">
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

        {/* Quiet utility links — Done + Backups open header panels; Sign out ends the session. */}
        <nav aria-label="Account" className="flex items-center gap-4 text-xs text-muted">
          <button type="button" onClick={() => setShowDone(true)} className="hover:text-ink">
            <span aria-hidden>✓</span> Done
          </button>
          <button type="button" onClick={() => setShowBackups(true)} className="hover:text-ink">
            <span aria-hidden>↻</span> Backups
          </button>
          <button
            type="button"
            onClick={() => void supabase.auth.signOut()}
            className="hover:text-ink"
          >
            Sign out
          </button>
        </nav>
      </header>

      {/* Plan My Day — a persistent inline card (not a modal), now top-center directly under the
          header. It hydrates from today's daily_state.plan, survives reloads, and auto-clears at
          local midnight. Placement only (B8); data logic unchanged. */}
      <div className="mb-5">
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

      <ErrorBoundary>
        <WorkArea chat={chat} onOpenChat={() => setShowChat(true)} />
      </ErrorBoundary>

      {/* Daily habits — a strip below the work region so it shows under BOTH Grid and List. */}
      <div className="mt-6 pb-10">
        <ErrorBoundary>
          <HabitsView />
        </ErrorBoundary>
      </div>

      {showChat && (
        <ErrorBoundary>
          <ChatPanel chat={chat} onClose={() => setShowChat(false)} />
        </ErrorBoundary>
      )}

      {showBackups && (
        <ErrorBoundary>
          <BackupsPanel onClose={() => setShowBackups(false)} />
        </ErrorBoundary>
      )}

      {showDone && (
        <ErrorBoundary>
          <DonePanel onClose={() => setShowDone(false)} />
        </ErrorBoundary>
      )}
    </>
  )
}

export default function App() {
  const { session, loading } = useSession()

  return (
    // A focused column (B8): wide enough that the desktop grid lands near EisenClaw's 1046px (so
    // the aspect-locked canvas ≈ 1046×640 and clustering feel matches — #75), but not so wide the
    // canvas overflows the viewport height.
    <main className="mx-auto min-h-screen max-w-3xl p-6 wide:max-w-[1120px]">
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
