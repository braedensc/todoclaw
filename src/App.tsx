import { useEffect, useRef, useState } from 'react'
import { AuthGate } from './features/auth/AuthGate'
import { useSession } from './features/auth/use-session'
import { useEnsureUserSchedule } from './features/schedule/use-user-schedule'
import { RemindersInline } from './features/habits/RemindersInline'
import { RemindersPage } from './features/habits/RemindersPage'
import { RemindersSheet } from './features/habits/RemindersSheet'
import { WorkArea } from './features/shell/WorkArea'
import { MobileBottomNav } from './features/shell/MobileBottomNav'
import { MoreSheet } from './features/shell/MoreSheet'
import { MobileAddSheet } from './features/shell/MobileAddSheet'
import { useQuadrantFocus } from './features/shell/use-quadrant-focus'
import { useIsMobile } from './hooks/use-is-mobile'
import { Snackbar } from './components/Snackbar'
import { quadrantMeta, type QuadrantKey } from './lib/quadrants'
import { QUADRANT_CENTER } from './lib/quadrant-summary'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TodoClawPeek } from './components/TodoClawPeek'
import { ConfirmProvider, useConfirm } from './components/use-confirm'
import { PlanBox } from './features/ai/PlanBox'
import { Thinking } from './components/Thinking'
import { usePlanController } from './features/ai/use-plan-controller'
import { useChatController } from './features/ai/use-chat-controller'
import { useTimeZone } from './features/schedule/use-time-zone'
import { ChatPanel } from './features/ai/ChatPanel'
import { ChatRail } from './features/ai/ChatRail'
import { BackupsPanel } from './features/backups/BackupsPanel'
import { DonePage } from './features/done/DonePage'
import { DoneSheet } from './features/done/DoneSheet'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { SetupGuide } from './features/onboarding/SetupGuide'
import { AdminPage } from './features/admin/AdminPage'
import { useIsOwner } from './features/auth/use-is-owner'
import { useRoute, navigate, navigateToChat, chatMessageId } from './lib/route'
import { supabase } from './lib/supabase'
import { NotificationBell } from './features/notifications/NotificationBell'
import { InboxPanel } from './features/notifications/InboxPanel'
import { useMessages, useMarkMessageRead } from './features/notifications/use-messages'

// Plan My Day pill (style mix): the ink fill warmed with a deep-green cast toward one corner,
// the ✦ picked out in gold — the header's one quiet "AI moment". Shared by the mobile and
// desktop headers so the pill is identical at every width.
const planPillStyle = { backgroundImage: 'linear-gradient(135deg, #2e2a24 20%, #2c4a3a 115%)' }

// The signed-in app shell (B8 layout): header (wordmark + Plan My Day + quiet Reminders/Settings/
// Done/Backups/Sign out links), the persistent Plan card top-center, the work region (a compact
// inline reminders list + one input widget + the Grid⇄List swap with its embedded toggle). Daily
// reminders live off the main page now — the inline names open per-reminder detail cards. Kept
// separate from App so the ensure-schedule effect only runs once a session exists.
//
// Done and Daily reminders are full pages, not modals (ADR-0027): a hash route (`useRoute`) swaps
// the home content for the page and the browser Back button pops it. Settings / Backups / Chat stay
// as route-independent overlays.
function AppShell() {
  const route = useRoute()
  const [showChat, setShowChat] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Set when Settings should open scrolled to a specific section (the setup guide's
  // "Turn on notifications" deep-link); cleared on close so a normal open starts at the top.
  const [settingsSection, setSettingsSection] = useState<'notifications' | undefined>(undefined)
  // The owner-only Admin panel is a route (`/#/admin`), not an overlay — invites now live inside it.
  // isOwner only reveals the entry point; the admin Edge Function enforces the real OWNER_USER_ID
  // gate server-side.
  const isOwner = useIsOwner()
  // The mobile "More" overflow sheet (Settings / Backups / Sign out) and the "+" add sheet.
  const [showMore, setShowMore] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  // Mobile overview→focus state (which quadrant list is open). App-owned so Back pops it and the
  // add sheet pre-selects it; inert on desktop (nothing ever calls enter there).
  const quadrantFocus = useQuadrantFocus()
  // Transient confirmation pill ("Added to Errands ✓") floated above the bottom nav — the add
  // sheet closes instantly and the task may land in a quadrant that isn't on screen (audit §4.2).
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }
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
  // Masthead dateline — "Tuesday — July 7, 2026" in the user's own timezone (the same zone all
  // "today" logic uses), so the printed day always matches the daily reset. Computed per render;
  // it only needs to be right for the session's day, not tick over live at midnight.
  const now = new Date()
  const dateline = `${now.toLocaleDateString('en-US', { weekday: 'long', timeZone })} — ${now.toLocaleDateString(
    'en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone },
  )}`
  // One conversation for the whole shell — shared by the inline BabyClaw reply and the chat popup.
  const chat = useChatController()
  // In-app inbox (ADR-0031): the bell/badge + the message list overlay.
  const [showInbox, setShowInbox] = useState(false)
  const messages = useMessages()
  const markRead = useMarkMessageRead()
  const confirm = useConfirm()
  // Sign out sits one tap deep in the mobile More sheet, right under Backups — a mis-tap used to
  // cost a full re-login (audit §4.7). Same guard on the desktop header link for consistency.
  const confirmSignOut = async () => {
    if (await confirm({ title: 'Sign out of Todoclaw?', confirmLabel: 'Sign out' }))
      void supabase.auth.signOut()
  }

  // Guarantee a user_schedule row exists on first authenticated load — the daily reset depends on
  // its timezone. Idempotent (upsert ignoreDuplicates); runs once on mount.
  const ensure = ensureSchedule.mutate
  useEffect(() => {
    ensure()
  }, [ensure])

  // A `#/chat/<id>` route (a notification tap or an inbox click) opens the chat overlay seeded with
  // that message. The overlay is shown whenever showChat OR the route is 'chat' (chatOpen, below), so
  // no setState-in-effect is needed here — this effect only seeds + marks the message read once it
  // loads. seed is idempotent per text; mark is a no-op once read, so re-runs settle.
  const seedChat = chat.seed
  const mark = markRead.mutate
  useEffect(() => {
    if (route !== 'chat') return
    const id = chatMessageId()
    if (!id || !messages.data) return
    const msg = messages.data.find((m) => m.id === id)
    if (!msg) return
    // Title + body on separate lines — plan-rich bodies are multi-line and the bubble is pre-wrap.
    seedChat(`${msg.title}\n\n${msg.body}`)
    if (!msg.read_at) mark(id)
  }, [route, messages.data, seedChat, mark])

  // Esc leaves grid-only mode (the overlay covers the header, so the ✕ pill + this are the exits).
  useEffect(() => {
    if (!gridOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGridOnly(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [gridOnly])

  // The chat overlay is open via the WorkArea button (showChat) OR a #/chat deep link (route). Both
  // the desktop push-drawer and the mobile sheet key off this; closing clears both and returns the
  // hash to home when the chat was opened by a deep link.
  const chatOpen = showChat || route === 'chat'
  const closeChat = () => {
    setShowChat(false)
    if (route === 'chat') navigate('home')
  }

  return (
    // Full-width shell so the desktop chat push-drawer (ChatRail, fixed to the viewport's right
    // edge) can pair with an animated right-padding on the main content: opening chat pads the
    // content by the drawer width, shrinking the grid column so the grid reflows left (B2). The
    // centered, max-width column lives on the INNER wrapper. On mobile the drawer is a covering
    // bottom-sheet (ChatPanel), so no padding is applied (`wide:` only).
    //
    // min-h-screen is desktop-only: on mobile the page is locked to the viewport and #root is the
    // scroll container (src/index.css), so a 100vh min-height here would force ~a safe-area's
    // worth of permanent overflow — i.e. the standalone-PWA scroll wiggle this replaces.
    <div className="relative min-h-full w-full wide:min-h-screen">
      <div
        className={
          'min-h-full wide:min-h-screen transition-[padding] duration-300 ease-out ' +
          (chatOpen ? 'wide:pr-[360px]' : '')
        }
      >
        {/* A focused column: wide enough that the desktop grid is dominant (aspect-locked ≈
            1046/640 so clustering feel matches — #75), centered, with the header/plan/input above
            it. Raised from 1120 → 1280 to grow the grid into the space the removed habits strip
            freed (B2). */}
        <div
          className={
            // pb-28 clears the taller fixed bottom nav (64px tabs + safe-area + breathing room).
            'mx-auto max-w-3xl p-6 wide:max-w-[1280px] ' + (isMobile && !gridOnly ? 'pb-28' : '')
          }
        >
          {/* Home vs. a full page. 'home' renders the header, plan, inline reminders, and work
              area; a Done / Daily-reminders page swaps all of that out (ADR-0027). The 'chat' route
              is home + the chat overlay — a notification tap must land on the main screen with the
              drawer open, not a blank shell. On MOBILE the 'reminders' AND 'done' routes are
              likewise home + a slide-up sheet (RemindersSheet / DoneSheet below) rather than a page
              swap, so the home screen stays visible behind them. The Settings / Backups overlays
              and the mobile bottom nav below are route-independent. */}
          {(route === 'home' ||
            route === 'chat' ||
            (isMobile && (route === 'reminders' || route === 'done'))) && (
            <>
              {isMobile ? (
                // Mobile (Concept D): a slim top row — wordmark + Plan pill only. The tagline, the
                // Grid-only pill, and the account links all move off the fold (bottom nav + More sheet).
                !gridOnly && (
                  // min-[360px]: the row is wider than a 320px-class viewport at full size (the
                  // nowrap pill used to push the whole page into horizontal scroll on iPhone SE),
                  // so below 360px the wordmark steps down a size and the pill shortens to "Plan".
                  <header className="mb-3 flex items-center justify-between gap-2 min-[360px]:gap-3">
                    <h1 className="flex items-center gap-1.5 font-serif text-xl font-semibold text-ink min-[360px]:text-2xl">
                      <TodoClawPeek playful className="h-7 w-7" /> Todoclaw
                      <span aria-hidden className="-ml-1.5 text-accent">
                        .
                      </span>
                    </h1>
                    <div className="flex shrink-0 items-center gap-2">
                      <NotificationBell
                        compact
                        onClick={() => setShowInbox(true)}
                        className="relative text-lg text-muted hover:text-ink"
                      />
                      <button
                        type="button"
                        onClick={planner.generate}
                        disabled={!planner.canGenerate}
                        title="Generate a schedule-aware daily plan from your grid, recurring chores, and habits"
                        className="whitespace-nowrap rounded-full bg-ink px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 min-[360px]:px-4"
                        style={planPillStyle}
                      >
                        {planner.isPending ? (
                          <Thinking label="Thinking" />
                        ) : (
                          <>
                            <span aria-hidden className="text-[#e8c47a]">
                              ✦
                            </span>{' '}
                            Plan
                            <span className="hidden min-[360px]:inline"> My Day</span>
                          </>
                        )}
                      </button>
                    </div>
                  </header>
                )
              ) : (
                <header className="mb-3">
                  {/* Masthead dateline (style mix) — a small-caps folio strip above the wordmark,
                      like a morning paper's date line. Hidden in grid-only along with the rest of
                      the masthead trim (the fullscreen overlay covers the header anyway). */}
                  {!gridOnly && (
                    <div className="mb-3 border-y border-border-strong px-0.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
                      {dateline}
                    </div>
                  )}
                  <div className="flex flex-col gap-3 wide:flex-row wide:flex-wrap wide:items-start wide:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Masthead wordmark: high-optical-size Fraunces, the peeking-pup mark
                            grown into the face of the app (bled vertically so the row's height
                            doesn't inflate), a terracotta full stop. */}
                        <h1
                          className="flex items-center gap-1.5 whitespace-nowrap font-serif text-2xl font-semibold text-ink wide:text-[38px] wide:font-[620] wide:tracking-[-0.015em]"
                          style={{ fontVariationSettings: "'opsz' 70" }}
                        >
                          <TodoClawPeek
                            playful
                            className="h-7 w-7 wide:-my-3 wide:mr-0.5 wide:h-[62px] wide:w-[62px] wide:drop-shadow-sm"
                          />
                          Todoclaw
                          <span aria-hidden className="-ml-1.5 text-accent">
                            .
                          </span>
                        </h1>
                        <button
                          type="button"
                          onClick={planner.generate}
                          disabled={!planner.canGenerate}
                          title="Generate a schedule-aware daily plan from your grid, recurring chores, and habits"
                          className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
                          style={planPillStyle}
                        >
                          {planner.isPending ? (
                            <Thinking label="Thinking" />
                          ) : (
                            <>
                              <span aria-hidden className="text-[#e8c47a]">
                                ✦
                              </span>{' '}
                              Plan My Day
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
                        <>
                          {/* Terracotta claw swipe under the wordmark — aligned under the text
                              (the 62px mark + gap on its left), three strokes fading like a
                              scratch through paper. */}
                          <svg
                            className="ml-[68px] block"
                            width="118"
                            height="14"
                            viewBox="0 0 118 14"
                            aria-hidden="true"
                          >
                            <path
                              d="M2,4 Q58,15 114,3"
                              stroke="#c2693f"
                              strokeWidth="2.6"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.9"
                            />
                            <path
                              d="M8,8 Q56,17 104,7"
                              stroke="#c2693f"
                              strokeWidth="2"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.55"
                            />
                            <path
                              d="M16,12 Q54,18 88,11"
                              stroke="#c2693f"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              fill="none"
                              opacity="0.3"
                            />
                          </svg>
                          <p className="mt-1 font-serif text-[15px] italic text-muted">
                            Where your tasks learn to sit and stay.
                          </p>
                        </>
                      )}
                    </div>

                    {/* Quiet utility links — Settings/Done/Backups open header panels; Sign out ends the session. */}
                    <nav
                      aria-label="Account"
                      className="flex items-center gap-4 text-xs text-muted"
                    >
                      <NotificationBell
                        onClick={() => setShowInbox(true)}
                        className="relative hover:text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => navigate('reminders')}
                        title="Daily reminders"
                        className="hover:text-ink"
                      >
                        <span aria-hidden>⚐</span> Daily reminders
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => navigate('admin')}
                          title="Owner admin panel"
                          className="hover:text-ink"
                        >
                          <span aria-hidden>❖</span> Admin
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        className="hover:text-ink"
                      >
                        <span aria-hidden>⚙</span> Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => navigate('done')}
                        className="hover:text-ink"
                      >
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
                        onClick={() => void confirmSignOut()}
                        className="hover:text-ink"
                      >
                        Sign out
                      </button>
                    </nav>
                  </div>
                  {/* Hairline rule closing the masthead before the plan/reminders/work region. */}
                  {!gridOnly && <div aria-hidden className="mt-3 h-px bg-ink/30" />}
                </header>
              )}

              {/* First-run setup guide — a dismissible checklist card (install as app → daily
          notifications → try Plan My Day) whose steps auto-detect completion. Renders only until
          dismissed or every step is done; a fully-set-up user never sees it. Above PlanBox so a
          plan generated from its last step appears directly beneath it. */}
              {!gridOnly && (
                <ErrorBoundary>
                  <SetupGuide
                    planReady={Boolean(planner.displayPlan)}
                    planPending={planner.isPending}
                    canPlan={planner.canGenerate}
                    onPlan={planner.generate}
                    onOpenNotificationSettings={() => {
                      setSettingsSection('notifications')
                      setShowSettings(true)
                    }}
                  />
                </ErrorBoundary>
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
                  quadrantFocus={quadrantFocus}
                />
              </ErrorBoundary>
            </>
          )}

          {/* Full pages (ADR-0027) — swapped in for the home content above when the route matches.
              Each keeps its original body (DoneView / HabitsView); only the container changed from
              modal to page. Back is the ✕ inside each (→ history.back) or the browser button.
              Done: a full page on desktop; on mobile a bottom sheet over the still-mounted home
              above (DoneSheet) — same `#/done` route either way, only the presentation differs. */}
          {route === 'done' && (
            <ErrorBoundary>{isMobile ? <DoneSheet /> : <DonePage />}</ErrorBoundary>
          )}

          {/* Daily reminders: a full page on desktop; on mobile a bottom sheet over the
              still-mounted home above. Same `#/reminders` route either way — deep links and the
              browser Back button behave identically, only the presentation differs. */}
          {route === 'reminders' && (
            <ErrorBoundary>{isMobile ? <RemindersSheet /> : <RemindersPage />}</ErrorBoundary>
          )}

          {/* Owner-only Admin panel (belt-and-suspenders: gated on isOwner here AND inside the page;
              the real gate is the server-side OWNER_USER_ID check in the admin Edge Function). */}
          {route === 'admin' && isOwner && (
            <ErrorBoundary>
              <AdminPage />
            </ErrorBoundary>
          )}

          {/* Route-independent overlays: Settings and Backups sit over whatever route is active. */}
          {showBackups && (
            <ErrorBoundary>
              <BackupsPanel onClose={() => setShowBackups(false)} />
            </ErrorBoundary>
          )}

          {showSettings && (
            <ErrorBoundary>
              <SettingsPanel
                initialSection={settingsSection}
                onClose={() => {
                  setShowSettings(false)
                  setSettingsSection(undefined)
                }}
              />
            </ErrorBoundary>
          )}

          {showInbox && (
            <ErrorBoundary>
              <InboxPanel
                onClose={() => setShowInbox(false)}
                onOpenMessage={(id) => {
                  setShowInbox(false)
                  navigateToChat(id)
                }}
              />
            </ErrorBoundary>
          )}

          {/* Mobile chrome (Concept D): the thumb-zone bottom nav + its "More" overflow sheet.
              Hidden in grid-only mode (the fullscreen grid owns the screen). */}
          {isMobile && !gridOnly && (
            <>
              <MobileBottomNav
                route={route}
                onHome={() => {
                  // "Home" from inside a focus list means the top level — the overview. On the
                  // home route the focus entry is consumed cleanly (exit → history.back); from
                  // another route we just drop the focus and navigate.
                  if (route === 'home' && quadrantFocus.focus) {
                    quadrantFocus.exit()
                  } else {
                    quadrantFocus.clear()
                    navigate('home')
                  }
                }}
                onAdd={() => setShowAdd(true)}
                onChat={() => setShowChat(true)}
                onDone={() => navigate('done')}
                onMore={() => setShowMore(true)}
              />
              <MobileAddSheet
                open={showAdd}
                defaultQuadrant={quadrantFocus.focus}
                onAdded={(dest: QuadrantKey) => {
                  const c = QUADRANT_CENTER[dest]
                  showToast(`Added to ${quadrantMeta(c.x, c.y).label} ✓`)
                }}
                onOpenChat={() => setShowChat(true)}
                onClose={() => setShowAdd(false)}
              />
              <Snackbar message={toast} />
              <MoreSheet
                open={showMore}
                onReminders={() => navigate('reminders')}
                onSettings={() => setShowSettings(true)}
                onBackups={() => setShowBackups(true)}
                onAdmin={isOwner ? () => navigate('admin') : undefined}
                onSignOut={() => void confirmSignOut()}
                onClose={() => setShowMore(false)}
              />
            </>
          )}
        </div>
      </div>

      {/* Chat — desktop push-drawer (shrinks the grid) + mobile covering bottom-sheet. Both are
          driven by the same `showChat` flag; only one is visible per breakpoint. */}
      <ChatRail chat={chat} open={chatOpen} onClose={closeChat} />
      {chatOpen && (
        <ErrorBoundary>
          <ChatPanel chat={chat} onClose={closeChat} />
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
        <main className="mx-auto min-h-full max-w-3xl p-6 wide:min-h-screen">
          <p className="text-muted">Loading…</p>
        </main>
      ) : session ? (
        // AppShell owns the full-width layout (its own centered column + the chat push-drawer).
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      ) : (
        // The mascot's front door (style mix, login pass): centered masthead wordmark — no
        // icon up here, the AuthMascot peeking over the card below is the star — with the claw
        // swipe and the sign-in tagline. AuthGate renders the card + mascot.
        <main className="mx-auto flex min-h-full max-w-3xl flex-col items-center p-6 pt-14 wide:min-h-screen">
          <h1
            className="font-serif text-[46px] font-[620] leading-none tracking-[-0.015em] text-ink"
            style={{ fontVariationSettings: "'opsz' 70" }}
          >
            Todoclaw
            <span aria-hidden className="text-accent">
              .
            </span>
          </h1>
          <svg className="mt-1.5" width="130" height="14" viewBox="0 0 118 14" aria-hidden="true">
            <path
              d="M2,4 Q58,15 114,3"
              stroke="#c2693f"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
              opacity="0.9"
            />
            <path
              d="M8,8 Q56,17 104,7"
              stroke="#c2693f"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
              opacity="0.55"
            />
            <path
              d="M16,12 Q54,18 88,11"
              stroke="#c2693f"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
              opacity="0.3"
            />
          </svg>
          <p className="mt-2.5 font-serif text-[17px] italic text-muted">Sit. Stay. Prioritize.</p>
          <div className="mt-1 w-full">
            <AuthGate />
          </div>
        </main>
      )}
    </ConfirmProvider>
  )
}
