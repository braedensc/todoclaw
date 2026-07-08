import type { ReactNode } from 'react'
import { useSetupGuide } from './use-setup-guide'

// SetupGuide — the first-run "Get set up" card, rendered at the top of the home shell on both
// desktop and mobile. It walks a new user through the three things that make Todoclaw feel like
// an app instead of a tab — install it, turn on the daily pushes, try Plan My Day — with each
// step auto-checking itself off (see use-setup-guide.ts). Deliberately a quiet parchment card in
// the PlanBox idiom, not a modal: the install gesture happens outside the page, so the card has
// to survive the user leaving and coming back in a different context.

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

export function SetupGuide({
  planReady,
  planPending,
  canPlan,
  onPlan,
  onOpenNotificationSettings,
}: {
  /** A plan exists for today (drives the auto-check of step 3). */
  planReady: boolean
  planPending: boolean
  canPlan: boolean
  onPlan: () => void
  /** Opens Settings scrolled to the Daily-notifications section. */
  onOpenNotificationSettings: () => void
}) {
  const guide = useSetupGuide(planReady)
  if (!guide.visible) return null

  const { install } = guide
  // iOS can't receive push from a browser tab at all — gate step 2 on the install until then.
  const iosNeedsInstall = install.context === 'ios' && !install.done
  let stepNo = 0
  const next = (): number => ++stepNo

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
          {guide.allDone ? 'You’re all set!' : 'Get set up'}
        </h2>
        <span className="text-xs text-muted-light">
          {guide.doneCount}/{guide.stepCount}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-muted">
        {guide.allDone
          ? 'Todoclaw is installed, your daily plan will find you, and the grid is ready. Go get it.'
          : 'A couple of quick steps to get the full Todoclaw experience on this device.'}
      </p>

      <ol className="mt-3 flex flex-col gap-3">
        {install.shown && (
          <Step index={next()} done={install.done} title="Install Todoclaw as an app">
            {install.context === 'ios' && (
              <StepHint>
                Tap <span className="text-ink">Share → Add to Home Screen</span>. On iPhone &amp;
                iPad this is required for notifications — you’ll sign in once more inside the app.
              </StepHint>
            )}
            {install.context === 'macos-safari' && (
              <StepHint>
                In Safari, choose <span className="text-ink">File → Add to Dock</span> — Todoclaw
                gets its own window and steadier notifications.
              </StepHint>
            )}
            {install.context === 'chromium' && (
              <>
                <StepHint>Give Todoclaw its own window, ready for notifications.</StepHint>
                {install.canPrompt ? (
                  <StepButton onClick={install.promptInstall}>Install app</StepButton>
                ) : (
                  <StepHint>
                    Look for the <span className="text-ink">install icon</span> in the address bar,
                    or your browser menu → “Install Todoclaw”.
                  </StepHint>
                )}
              </>
            )}
          </Step>
        )}

        <Step index={next()} done={guide.notificationsDone} title="Turn on daily notifications">
          <StepHint>A morning plan and an evening recap, delivered to this device.</StepHint>
          {iosNeedsInstall ? (
            <StepHint>
              <span aria-hidden>↑</span> Install the app first, then come back here.
            </StepHint>
          ) : (
            <StepButton onClick={onOpenNotificationSettings}>Turn on notifications</StepButton>
          )}
        </Step>

        <Step index={next()} done={guide.planDone} title="Try Plan My Day">
          <StepHint>
            One tap turns your grid, chores, and habits into a realistic plan for today.
          </StepHint>
          <StepButton onClick={onPlan} disabled={!canPlan || planPending}>
            <span aria-hidden className="text-[#b58a3d]">
              ✦
            </span>{' '}
            {planPending ? 'Planning…' : 'Generate today’s plan'}
          </StepButton>
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
    </section>
  )
}
