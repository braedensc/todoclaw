import { useState, type ReactNode } from 'react'
import { useSetupGuide, type InstallContext } from './use-setup-guide'
import { InstallGuide } from './InstallGuide'
import { useEnableNotifications } from '../notifications/use-enable-notifications'
import { SafariTroubleshooting } from '../notifications/NotificationSettings'
import { useIsMobile } from '../../hooks/use-is-mobile'

// SetupGuide — the first-run "Get set up" card, rendered at the top of the home shell on both
// desktop and mobile. Reworked for non-technical users (2026-07-08): it now opens with a
// one-line pitch of what Todoclaw IS, then walks five steps in plain words — take the guided
// tour, install (with a "Show me how" walkthrough of the exact buttons to tap), turn on
// notifications (a button that really enables them, no Settings detour), add a first task
// (spotlights the Task Manager / opens the ➕ sheet), and only then try Plan My Day — with each
// step auto-checking itself off (see use-setup-guide.ts). Deliberately a quiet parchment card in
// the PlanBox idiom, not a modal: the install gesture happens outside the page, so the card has
// to survive the user leaving and coming back in a different context.
//
// On a PHONE the full card ate ~55% of the first screen and pushed the actual task matrix below
// the fold on every launch until dismissed (mobile audit §4.6) — so below 720px it starts as a
// one-line "🐾 Get set up · 1/5 ▸" banner that expands on tap (and can be collapsed again).
// Desktop always renders the full card; the collapse state is session-local by design.

function Step({
  index,
  done,
  title,
  children,
}: {
  index: number
  done: boolean
  title: string
  children?: ReactNode
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ' +
          (done ? 'bg-primary text-white' : 'border border-border-strong bg-card text-muted')
        }
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className={'text-sm font-medium ' + (done ? 'text-muted line-through' : 'text-ink')}>
          {title}
          {done && <span className="sr-only"> — done</span>}
        </p>
        {/* Finished steps collapse to their title so the card slims down as setup progresses. */}
        {!done && children}
      </div>
    </li>
  )
}

function StepHint({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[13px] leading-snug text-muted">{children}</p>
}

function StepButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="mt-2 rounded-full border border-border-strong bg-card px-4 py-1.5 text-[13px] font-medium text-ink hover:border-ink disabled:opacity-50"
    >
      {children}
    </button>
  )
}

// Plain-words step titles/hints per install gesture — "Install as an app" is browser jargon;
// "Add to your Home Screen" is the words on the actual button.
const INSTALL_TITLE: Record<InstallContext, string> = {
  ios: 'Add Todoclaw to your Home Screen',
  'macos-safari': 'Add Todoclaw to your Dock',
  chromium: 'Install the Todoclaw app',
  unknown: 'Install the Todoclaw app',
}
const INSTALL_HINT: Record<InstallContext, string> = {
  ios: 'It becomes a real app — its own icon, full screen. On iPhone & iPad this is also the only way to get notifications.',
  'macos-safari': 'Todoclaw gets its own window in your Dock, with steadier notifications.',
  chromium: 'Todoclaw gets its own window and dock icon, ready for notifications.',
  unknown: '',
}

export function SetupGuide({
  planReady,
  planPending,
  canPlan,
  onPlan,
  onOpenNotificationSettings,
  onStartTour,
  onShowAddTask,
}: {
  /** A plan exists for today (drives the auto-check of the Plan step). */
  planReady: boolean
  planPending: boolean
  canPlan: boolean
  onPlan: () => void
  /** Opens Settings scrolled to the Daily-notifications section (the "pick your times" link). */
  onOpenNotificationSettings: () => void
  /** Launches the FeatureTour walkthrough (App owns the overlay + the per-breakpoint script). */
  onStartTour: () => void
  /** "Show me where" — spotlight the Task Manager (desktop) / open the ➕ add sheet (mobile). */
  onShowAddTask: () => void
}) {
  const guide = useSetupGuide(planReady)
  const notif = useEnableNotifications()
  const isMobile = useIsMobile()
  // Mobile launches collapsed (initializer captures mount-time breakpoint; a mid-session
  // resize across 720px is a desktop-devtools case, not a phone one).
  const [expanded, setExpanded] = useState(() => !isMobile)
  const [showInstallGuide, setShowInstallGuide] = useState(false)
  if (!guide.visible) return null

  const { install } = guide
  // iOS can't receive push from a browser tab at all — gate the step on the install until then.
  const iosNeedsInstall = install.context === 'ios' && !install.done
  let stepNo = 0
  const next = (): number => ++stepNo

  const heading = guide.allDone ? 'You’re all set!' : 'Get set up'

  // Collapsed banner (mobile only): one tappable line — title + progress + a chevron — with the
  // ✕ dismiss still available. Everything else waits behind the tap.
  if (isMobile && !expanded) {
    return (
      <section
        aria-label="Setup guide"
        className="relative mb-3 rounded-[14px] border border-border bg-panel px-4 py-1.5"
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex min-h-[44px] w-full items-center gap-2 pr-8 text-left"
        >
          <span aria-hidden>🐾</span>
          <span className="font-serif text-[15px] font-semibold text-ink">{heading}</span>
          <span className="text-xs text-muted-light">
            {guide.doneCount}/{guide.stepCount}
          </span>
          <span aria-hidden className="ml-auto text-muted">
            ▸
          </span>
        </button>
        <button
          type="button"
          onClick={guide.dismiss}
          aria-label="Dismiss setup guide"
          title="Hide this guide (you can bring it back from Settings)"
          className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-muted hover:text-ink"
        >
          ✕
        </button>
      </section>
    )
  }

  return (
    <section
      aria-label="Setup guide"
      className="relative mb-3 rounded-[14px] border border-border bg-panel px-5 py-4"
    >
      <button
        type="button"
        onClick={guide.dismiss}
        aria-label="Dismiss setup guide"
        title="Hide this guide (you can bring it back from Settings)"
        className="absolute right-3 top-3 text-muted hover:text-ink"
      >
        ✕
      </button>

      <div className="flex items-baseline gap-2 pr-6">
        <h2 className="font-serif text-base font-semibold text-ink">
          <span aria-hidden className="mr-1.5">
            🐾
          </span>
          {heading}
        </h2>
        <span className="text-xs text-muted-light">
          {guide.doneCount}/{guide.stepCount}
        </span>
        {/* Fold the card back to the banner — phones only (desktop has no collapsed state). */}
        {isMobile && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded
            className="ml-auto flex h-8 items-center gap-1 rounded px-2 text-xs text-muted hover:text-ink"
          >
            Collapse <span aria-hidden>▴</span>
          </button>
        )}
      </div>
      {/* The one-line pitch: what Todoclaw IS, before any step asks for anything. */}
      <p className="mt-0.5 text-[13px] leading-snug text-muted">
        {guide.allDone
          ? 'You know your way around, Todoclaw is installed, and your daily plan will find you. Go get it.'
          : 'Welcome! Todoclaw is your to-do list on a map — tasks land by how urgent and important they are, so what to do next is always obvious. A few quick steps:'}
      </p>

      <ol className="mt-3 flex flex-col gap-3">
        <Step index={next()} done={guide.tourDone} title="See how Todoclaw works">
          <StepHint>
            A 30-second walk through the essentials: the grid, BabyClaw (your AI helper), Plan My
            Day, and daily habits.
          </StepHint>
          <StepButton onClick={onStartTour}>Take the tour</StepButton>
        </Step>

        {install.shown && (
          <Step index={next()} done={install.done} title={INSTALL_TITLE[install.context]}>
            <StepHint>{INSTALL_HINT[install.context]}</StepHint>
            {install.canPrompt && (
              <StepButton onClick={install.promptInstall}>Install now</StepButton>
            )}{' '}
            <StepButton onClick={() => setShowInstallGuide(true)}>Show me how</StepButton>
          </Step>
        )}

        <Step index={next()} done={guide.notificationsDone} title="Turn on daily notifications">
          <StepHint>
            Your plan each morning and a recap each evening, sent right to this device.
          </StepHint>
          {iosNeedsInstall ? (
            <StepHint>
              <span aria-hidden>↑</span> Add Todoclaw to your Home Screen first, then come back
              here.
            </StepHint>
          ) : (
            <>
              <StepButton onClick={() => void notif.enable()} disabled={notif.busy}>
                <span aria-hidden>🔔</span> {notif.busy ? 'Turning on…' : 'Turn on notifications'}
              </StepButton>
              {notif.error && <p className="mt-1.5 text-[13px] text-danger">{notif.error}</p>}
              {notif.setupFailed && (
                <div className="mt-2">
                  <SafariTroubleshooting />
                </div>
              )}
              <StepHint>
                Comes set to 8 AM and 9 PM — change the times any time in{' '}
                <button
                  type="button"
                  onClick={onOpenNotificationSettings}
                  className="underline hover:text-ink"
                >
                  Settings
                </button>
                .
              </StepHint>
            </>
          )}
        </Step>

        <Step index={next()} done={guide.taskAdded} title="Add your first task">
          <StepHint>
            {isMobile
              ? 'Tap the ➕ at the bottom of the screen and describe it — or tell BabyClaw in Chat (“dentist Friday 2pm”) and he’ll add it for you.'
              : 'Use the Task Manager box above the grid: tell BabyClaw in plain English (“dentist Friday 2pm”) and he’ll place it — or switch to Manual to do it yourself.'}
          </StepHint>
          <StepButton onClick={onShowAddTask}>
            {isMobile ? 'Add a task' : 'Show me where'}
          </StepButton>
        </Step>

        <Step index={next()} done={guide.planDone} title="Try Plan My Day">
          <StepHint>
            One tap reads your tasks, chores, and habits and drafts a realistic plan for today.
          </StepHint>
          {guide.taskAdded ? (
            <StepButton onClick={onPlan} disabled={!canPlan || planPending}>
              <span aria-hidden className="text-[#b58a3d]">
                ✦
              </span>{' '}
              {planPending ? 'Planning…' : 'Generate today’s plan'}
            </StepButton>
          ) : (
            <StepHint>
              <span aria-hidden>↑</span> Add a task first — the plan is built from what’s on your
              grid.
            </StepHint>
          )}
        </Step>
      </ol>

      {guide.allDone && (
        <button
          type="button"
          onClick={guide.dismiss}
          className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Finish setup
        </button>
      )}

      {showInstallGuide && (
        <InstallGuide
          context={install.context}
          canPrompt={install.canPrompt}
          onInstallNow={install.promptInstall}
          onClose={() => setShowInstallGuide(false)}
        />
      )}
    </section>
  )
}
