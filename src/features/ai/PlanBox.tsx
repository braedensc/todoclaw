import type { ReactNode } from 'react'
import type { DayPlan, PlanRock } from '../../types/plan'

// The inline "Plan My Day" card — a PERSISTENT parchment box above the grid (not a modal). It
// hydrates from daily_state.plan on load, stays for the whole local day, and disappears after
// local midnight (a new day reads a different date's row). Closely mirrors EisenClaw's plan card
// (planning/eisenclaw-export/scripts/planner.html ~L680-717): serif headline, an ⏰ available-time
// line, an orange BIG ROCK, a then/also small-rocks list, and a green ↻ habit note.
//
// The box appears ONLY once a plan exists or one is actively generating (pending) — plus the quiet
// error/paused notices. With no plan and nothing in flight it renders NOTHING (no placeholder,
// no border); the header "Plan My Day" button is the sole trigger and owns its own thinking state.
// A × in the top-right dismisses a shown plan (App clears the persisted row via usePlanController).
//
// Purely presentational: App owns the data + mutation (usePlanController) and passes the resolved
// plan (fresh mutation result OR the persisted copy) plus status in.
export function PlanBox({
  plan,
  paused,
  isPending,
  isError,
  onRetry,
  onDismiss,
  mobile = false,
}: {
  plan: DayPlan | null
  paused: boolean
  isPending: boolean
  isError: boolean
  onRetry: () => void
  onDismiss: () => void
  // Mobile swaps the tiny corner ✕ (a fiddly touch target) for a full-width footer "Dismiss"
  // button beneath the plan. Desktop keeps the corner ✕.
  mobile?: boolean
}) {
  // Idle with no plan → render nothing at all. App gates the wrapper on the same condition so no
  // empty margin is left behind.
  if (!plan && !isPending && !isError && !paused) return null

  return (
    <section
      aria-label="Plan My Day"
      className="relative rounded-[14px] border border-border bg-panel px-5 py-3.5"
    >
      {plan ? (
        // Leave room for the corner ✕ on desktop; on mobile the dismiss is a footer button, no gap.
        <div className={mobile ? 'flex flex-col' : 'flex flex-col pr-6'}>
          {isError && (
            // A regenerate failed but the saved plan is still shown — offer a quiet retry.
            <p className="mb-2 text-[13px] text-accent">
              Couldn't refresh —{' '}
              <button type="button" onClick={onRetry} className="underline hover:text-ink">
                try again
              </button>
              .
            </p>
          )}
          <PlanContent plan={plan} />
        </div>
      ) : isPending ? (
        <p className="text-[14px] text-muted">Planning your day…</p>
      ) : isError ? (
        <div className="flex flex-col gap-3">
          <p className="text-[14px] text-accent">Couldn't generate a plan.</p>
          <button
            type="button"
            onClick={onRetry}
            className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      ) : (
        // The only remaining state (guarded above): AI paused for the month, no plan.
        <p className="text-[14px] text-accent">
          AI is paused for this month — the budget cap was reached. The planner still works without
          it.
        </p>
      )}

      {plan &&
        (mobile ? (
          // Mobile: a full-width, tap-friendly footer button (the corner ✕ was too small to hit).
          <button
            type="button"
            onClick={onDismiss}
            className="mt-4 w-full rounded-xl border border-border bg-card py-3 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            Dismiss today's plan
          </button>
        ) : (
          // Desktop: the quiet corner ✕. focus-visible only, so a mouse click leaves no lingering
          // ring; matches the app's other close buttons (e.g. DoneView).
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss plan"
            className="absolute right-3 top-3 rounded text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            ✕
          </button>
        ))}
    </section>
  )
}

// The rendered plan: headline, available time, big rock, small rocks, habit note.
function PlanContent({ plan }: { plan: DayPlan }) {
  return (
    <div className="flex flex-col">
      <p className="font-serif text-[19px] font-medium leading-snug text-ink">{plan.headline}</p>
      {plan.availableTime && (
        <p className="mt-1 text-[12.5px] text-muted">⏰ {plan.availableTime}</p>
      )}

      {plan.bigRock && (
        <div className="mt-3 flex items-start gap-2.5">
          <span className="mt-0.5 shrink-0 rounded-md bg-accent px-[7px] py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            Big rock
          </span>
          <RockBody rock={plan.bigRock} emphasis />
        </div>
      )}

      {plan.smallRocks.map((r, i) => (
        <div className="mt-[7px] flex items-start gap-2.5" key={i}>
          {/* then/also under a big rock; a bullet when there is none (mirrors EisenClaw). */}
          <span className="mt-[3px] w-[34px] shrink-0 text-[12px] font-semibold text-muted-light">
            {plan.bigRock ? (i === 0 ? 'then' : 'also') : '•'}
          </span>
          <RockBody rock={r} />
        </div>
      ))}

      {plan.habitNote && <p className="mt-3 text-[13px] italic text-primary">↻ {plan.habitNote}</p>}
    </div>
  )
}

function RockBody({ rock, emphasis }: { rock: PlanRock; emphasis?: boolean }) {
  return (
    <div className="flex-1">
      <div
        className={
          emphasis
            ? 'text-[15.5px] font-semibold leading-snug text-ink'
            : 'text-[14px] font-medium leading-snug text-ink'
        }
      >
        {rock.task}
      </div>
      {rock.why && <div className="mt-0.5 text-[12.5px] text-muted">{rock.why}</div>}
      <div className="mt-[5px] flex flex-wrap gap-[5px]">
        {rock.duration && <Chip>⏱ {rock.duration}</Chip>}
        {rock.when && <Chip>◎ {rock.when}</Chip>}
      </div>
    </div>
  )
}

// Small duration / when pill — the warm inset paper chip from the EisenClaw card.
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-[#f0ebe0] px-[7px] py-0.5 text-[10.5px] font-medium text-muted">
      {children}
    </span>
  )
}
