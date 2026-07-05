import type { ReactNode } from 'react'
import { AiPrivacyNote } from './AiPrivacyNote'
import type { DayPlan, PlanRock } from '../../types/plan'

// The inline "Plan My Day" card — a PERSISTENT parchment box above the grid (not a modal). It
// hydrates from daily_state.plan on load, stays for the whole local day, and disappears after
// local midnight (a new day reads a different date's row). Closely mirrors EisenClaw's plan card
// (planning/eisenclaw-export/scripts/planner.html ~L680-717): serif headline, an ⏰ available-time
// line, an orange BIG ROCK, a then/also small-rocks list, a green ↻ habit note, and a pre-generate
// empty state.
//
// Purely presentational: App owns the data + mutation (usePlanController) and passes the resolved
// plan (fresh mutation result OR the persisted copy) plus status in. The header "Plan My Day"
// button is the (re)generate trigger.
export function PlanBox({
  plan,
  paused,
  isPending,
  isError,
  onRetry,
}: {
  plan: DayPlan | null
  paused: boolean
  isPending: boolean
  isError: boolean
  onRetry: () => void
}) {
  return (
    <section
      aria-label="Plan My Day"
      className="rounded-[14px] border border-border bg-panel px-5 py-3.5"
    >
      {plan ? (
        <div className="flex flex-col">
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
          <div className="mt-4">
            <AiPrivacyNote compact />
          </div>
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
      ) : paused ? (
        <p className="text-[14px] text-accent">
          AI is paused for this month — the budget cap was reached. The planner still works without
          it.
        </p>
      ) : (
        <p className="text-[14px] leading-relaxed text-muted">
          Tap <em>Plan My Day</em> — reads your grid, recurring chores, and habits for a
          schedule-aware plan.
        </p>
      )}
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
