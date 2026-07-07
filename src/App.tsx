import { useEffect, useState } from 'react'
import { AuthForm } from './features/auth/AuthForm'
import { useSession } from './features/auth/use-session'
import { useEnsureUserSchedule } from './features/schedule/use-user-schedule'
import { RemindersInline } from './features/habits/RemindersInline'
import { RemindersModal } from './features/habits/RemindersModal'
import { WorkArea } from './features/shell/WorkArea'
import { MobileBottomNav } from './features/shell/MobileBottomNav'
import { MoreSheet } from './features/shell/MoreSheet'
import { MobileAddSheet } from './features/shell/MobileAddSheet'
import { useIsMobile } from './hooks/use-is-mobile'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TodoClawIcon } from './components/TodoClawIcon'
import { ConfirmProvider } from './components/use-confirm'
import { PlanBox } from './features/ai/PlanBox'
import { Thinking } from './components/Thinking'
import { usePlanController } from './features/ai/use-plan-controller'
import { useChatController } from './features/ai/use-chat-controller'
import { useTimeZone } from './features/schedule/use-time-zone'
import { ChatPanel } from './features/ai/ChatPanel'
import { ChatRail } from './features/ai/ChatRail'
import { BackupsPanel } from './features/backups/BackupsPanel'
import { DonePanel } from './features/done/DonePanel'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { supabase } from './lib/supabase'

// The signed-in app shell (B8 layout): header (wordmark + Plan My Day + quiet Reminders/Settings/
// Done/Backups/Sign out links), the persistent Plan card top-center, the work region (a compact
// inline reminders list + one input widget + the Grid⇄List swap with its embedded toggle). Daily
// reminders live off the main page now — a gear-area button opens the full popup and the inline
// names open per-reminder detail cards. Kept separate from App so the ensure-schedule effect only
// runs once a session exists.
function AppShell() {
  const [showChat, setShowChat] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showReminders, setShowReminders] = useState(false)
  // The mobile "More" overflow sheet (Settings / Backups / Sign out) and the "+" add sheet.
  const [showMore, setShowMore] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // Grid-only view: the grid goes fullscreen and everything else on the shell is hidden. Entered
  // from the header pill (desktop) or the More sheet (mobile); left via the overlay's ✕ pill or Esc.
  const [gridOnly, setGridOnly] = useState(false)
  // Below 720px the tall header is replaced by a slim top bar + a thumb-zone bottom nav (Concept D,
  // ADR-0026). JS-gated (not just CSS) so exactly one Account nav renders per environment — keeping
  // the golden `openDone` selector unambiguous and desktop untouched.
  const isMobile = useIsMobile()
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

  // Esc leaves grid-only mode (the overlay covers the header, so the ✕ pill + this are the exits).
  useEffect(() => {
    if (!gridOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGridOnly(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gridOnly])

  return (
    // Full-width shell so the desktop chat push-drawer (ChatRail, fixed to the viewport's right
    // edge) can pair with an animated right-padding on the main content: opening chat pads the
    // content by the drawer width, shrinking the grid column so the grid reflows left (B2). The
    // centered, max-width column lives on the INNER wrapper. On mobile the drawer is a covering
    // bottom-sheet (ChatPanel), so no padding is applied (`wide:` only).
    <div className="relative min-h-screen w-full">
      <div
        className={
          'min-h-screen transition-[padding] duration-300 ease-out ' +
          (showChat ? 'wide:pr-[360px]' : '')
        }
      >
        {/* A focused column: wide enough that the desktop grid is dominant (aspect-locked ≈
            1046/640 so clustering feel matches — #75), centered, with the header/plan/input above
            it. Raised from 1120 → 1280 to grow the grid into the space the removed habits strip
            freed (B2). */}
        <div
          className={
            'mx-auto max-w-3xl p-6 wide:max-w-[1280px] ' + (isMobile && !gridOnly ? 'pb-24' : '')
          }
        >
          {isMobile ? (
            // Mobile (Concept D): a slim top row — wordmark + Plan pill only. The tagline, the
            // Grid-only pill, and the account links all move off the fold (bottom nav + More sheet).
            !gridOnly && (
              <header className="mb-3 flex items-center justify-between gap-3">
                <h1 className="flex items-center gap-1.5 font-serif text-2xl font-semibold text-ink">
                  <TodoClawIcon className="h-6 w-6" /> Todoclaw
                </h1>
                <button
                  type="button"
                  onClick={planner.generate}
                  disabled={!planner.canGenerate}
                  title="Generate a schedule-aware daily plan from your grid, recurring chores, and habits"
                  className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {planner.isPending ? (
                    <Thinking label="Thinking" />
                  ) : (
                    <>
                      <span aria-hidden>✦</span> Plan My Day
                    </>
                  )}
                </button>
              </header>
            )
          ) : (
            <header className="mb-3 flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-start wide:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="flex items-center gap-1.5 font-serif text-2xl font-semibold text-ink wide:text-3xl">
                    <TodoClawIcon className="h-6 w-6 wide:h-7 wide:w-7" /> Todoclaw
                  </h1>
                  <button
                    type="button"
                    onClick={planner.generate}
                    disabled={!planner.canGenerate}
                    title="Generate a schedule-aware daily plan from your grid, recurring chores, and habits"
                    className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {planner.isPending ? (
                      <Thinking label="Thinking" />
                    ) : (
                      <>
                        <span aria-hidden>✦</span> Plan My Day
                      </>
                    )}
                  </button>
                  {/* Grid-only view — a large pill matching Plan My Day's size, in the app's brand
                      green (the same fill as Add / Set / Save actions). Enters a fullscreen,
                      grid-alone mode (tagline / plan / reminders / input / toggle all hidden). */}
                  <button
                    type="button"
                    onClick={() => setGridOnly(true)}
                    title="Fill the screen with just the grid — hide everything else"
                    className="whitespace-nowrap rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    <span aria-hidden>▦</span> Grid-only view
                  </button>
                </div>
                {!gridOnly && (
                  <p className="text-sm text-muted">
                    An AI-enabled planner built on the Eisenhower matrix — sort tasks into quadrants
                    by urgency and importance.
                  </p>
                )}
              </div>

              {/* Quiet utility links — Settings/Done/Backups open header panels; Sign out ends the session. */}
              <nav aria-label="Account" className="flex items-center gap-4 text-xs text-muted">
                <button
                  type="button"
                  onClick={() => setShowReminders(true)}
                  title="Daily reminders"
                  className="hover:text-ink"
                >
                  <span aria-hidden>⚐</span> Daily reminders
                </button>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className="hover:text-ink"
                >
                  <span aria-hidden>⚙</span> Settings
                </button>
                <button type="button" onClick={() => setShowDone(true)} className="hover:text-ink">
                  <span aria-hidden>✓</span> Done
                </button>
                <button
                  type="button"
                  onClick={() => setShowBackups(true)}
                  className="hover:text-ink"
                >
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
          )}

          {/* Plan My Day — a persistent inline card (not a modal), top-center under the header. It
          hydrates from today's daily_state.plan, survives reloads, and auto-clears at local
          midnight. The box (and its margin wrapper) only render once there's a plan, a generation
          in flight, or an error/paused notice — otherwise nothing shows and the header button is
          the sole trigger. Gate the wrapper on the same condition PlanBox uses to return null so no
          empty margin is left behind. */}
          {!gridOnly &&
            (planner.displayPlan || planner.isPending || planner.isError || planner.paused) && (
              <div className="mb-3">
                <ErrorBoundary>
                  <PlanBox
                    plan={planner.displayPlan}
                    paused={planner.paused}
                    isPending={planner.isPending}
                    isError={planner.isError}
                    onRetry={planner.generate}
                    onDismiss={planner.clear}
                  />
                </ErrorBoundary>
              </div>
            )}

          {/* Daily reminders — the minified inline form: a compact row of active reminder names near
          the top of the work area. Each name opens that reminder's detail card; the full popup is
          the gear-area Reminders button. The old full-width habits strip is gone (B2 owns the grid
          expansion into the freed space). Hidden in grid-only mode. */}
          {!gridOnly && (
            <ErrorBoundary>
              <RemindersInline />
            </ErrorBoundary>
          )}

          <ErrorBoundary>
            <WorkArea
              chat={chat}
              onOpenChat={() => setShowChat(true)}
              gridOnly={gridOnly}
              onExitGridOnly={() => setGridOnly(false)}
            />
          </ErrorBoundary>

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

          {showSettings && (
            <ErrorBoundary>
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </ErrorBoundary>
          )}

          {showReminders && (
            <ErrorBoundary>
              <RemindersModal onClose={() => setShowReminders(false)} />
            </ErrorBoundary>
          )}

          {/* Mobile chrome (Concept D): the thumb-zone bottom nav + its "More" overflow sheet.
              Hidden in grid-only mode (the fullscreen grid owns the screen). */}
          {isMobile && !gridOnly && (
            <>
              <MobileBottomNav
                onAdd={() => setShowAdd(true)}
                onReminders={() => setShowReminders(true)}
                onDone={() => setShowDone(true)}
                onMore={() => setShowMore(true)}
              />
              <MobileAddSheet
                open={showAdd}
                chat={chat}
                onOpenChat={() => setShowChat(true)}
                onClose={() => setShowAdd(false)}
              />
              <MoreSheet
                open={showMore}
                onSettings={() => setShowSettings(true)}
                onBackups={() => setShowBackups(true)}
                onSignOut={() => void supabase.auth.signOut()}
                onClose={() => setShowMore(false)}
              />
            </>
          )}
        </div>
      </div>

      {/* Chat — desktop push-drawer (shrinks the grid) + mobile covering bottom-sheet. Both are
          driven by the same `showChat` flag; only one is visible per breakpoint. */}
      <ChatRail chat={chat} open={showChat} onClose={() => setShowChat(false)} />
      {showChat && (
        <ErrorBoundary>
          <ChatPanel chat={chat} onClose={() => setShowChat(false)} />
        </ErrorBoundary>
      )}
    </div>
  )
}

export default function App() {
  const { session, loading } = useSession()

  return (
    // ConfirmProvider hosts the single app-themed confirm dialog (useConfirm) for every surface
    // beneath it — replacing bare window.confirm() calls. It wraps the whole shell so any view
    // (signed-in or auth) can gate a destructive action through it.
    <ConfirmProvider>
      {loading ? (
        <main className="mx-auto min-h-screen max-w-3xl p-6">
          <p className="text-muted">Loading…</p>
        </main>
      ) : session ? (
        // AppShell owns the full-width layout (its own centered column + the chat push-drawer).
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      ) : (
        <main className="mx-auto min-h-screen max-w-3xl p-6">
          <div className="mx-auto max-w-sm">
            <h1 className="mb-6 flex items-center gap-2 font-serif text-3xl font-semibold text-ink">
              <TodoClawIcon className="h-7 w-7" /> Todoclaw
            </h1>
            <AuthForm />
          </div>
        </main>
      )}
    </ConfirmProvider>
  )
}
