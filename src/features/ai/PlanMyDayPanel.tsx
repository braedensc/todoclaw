import { useEffect, useRef } from 'react'
import { useTasks } from '../tasks/use-tasks'
import { useHabits } from '../habits/use-habits'
import { useDailyState } from '../daily-state/use-daily-state'
import { useTimeZone } from '../schedule/use-time-zone'
import { useAiStatus } from './use-ai-status'
import { usePlanMyDay, buildPlanRequest, type PlanRock } from './use-plan-my-day'
import { AiPrivacyNote } from './AiPrivacyNote'

// Plan My Day — a transient modal (not a tab): open it, it generates today's schedule-aware plan
// once, and you can regenerate. The model call is server-side (owner key); this panel only sends
// the day's tasks/habits and renders the structured result.
export function PlanMyDayPanel({ onClose }: { onClose: () => void }) {
  const timeZone = useTimeZone()
  const tasksQ = useTasks()
  const habitsQ = useHabits()
  const dailyQ = useDailyState(timeZone)
  const status = useAiStatus()
  const plan = usePlanMyDay()

  const paused = status.data?.paused ?? false
  const dataReady = !tasksQ.isLoading && !habitsQ.isLoading && !dailyQ.isLoading

  // Auto-generate once, when the data is ready and AI isn't paused.
  const started = useRef(false)
  const generate = () => {
    plan.mutate(
      buildPlanRequest(tasksQ.data ?? [], habitsQ.data ?? [], dailyQ.data?.done ?? {}, timeZone),
    )
  }
  useEffect(() => {
    if (started.current || paused || !dataReady) return
    // React 18 StrictMode mounts this panel, unmounts it, then remounts it. A mutation fired
    // synchronously here runs on the throwaway first mount's observer; the remounted observer
    // inherits that mutation's "pending" state but never its resolution, so the panel hangs on
    // "Planning your day…". Defer the trigger to a macrotask and cancel it on the throwaway
    // unmount, so only the surviving mount actually starts the request. (In production, where
    // StrictMode is a no-op, this is a harmless one-tick delay.)
    let cancelled = false
    const id = setTimeout(() => {
      if (cancelled || started.current) return
      started.current = true
      generate()
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, dataReady])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plan My Day"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border-strong bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold text-ink">Plan My Day</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {paused ? (
          <p className="text-sm text-accent">
            AI is paused for this month — the budget cap was reached. The planner still works
            without it.
          </p>
        ) : plan.isPending ? (
          <p className="text-muted">Planning your day…</p>
        ) : plan.isError ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-accent">Couldn't generate a plan. Try again.</p>
            <button
              type="button"
              onClick={generate}
              className="self-start rounded bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Retry
            </button>
          </div>
        ) : plan.data ? (
          <div className="flex flex-col gap-5">
            <div>
              <p className="font-serif text-lg text-ink">{plan.data.headline}</p>
              <p className="mt-1 text-sm text-muted">{plan.data.availableTime}</p>
            </div>

            {plan.data.bigRock && <RockCard label="Big rock" rock={plan.data.bigRock} emphasis />}

            {plan.data.smallRocks.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-light">
                  Small rocks
                </p>
                {plan.data.smallRocks.map((r, i) => (
                  <RockCard key={i} rock={r} />
                ))}
              </div>
            )}

            <p className="text-sm italic text-muted">{plan.data.habitNote}</p>

            <button
              type="button"
              onClick={generate}
              className="self-start text-sm text-muted underline hover:text-ink"
            >
              Regenerate
            </button>
          </div>
        ) : (
          <p className="text-muted">Loading your day…</p>
        )}

        <div className="mt-5 border-t border-border pt-3">
          <AiPrivacyNote />
        </div>
      </div>
    </div>
  )
}

function RockCard({
  rock,
  label,
  emphasis,
}: {
  rock: PlanRock
  label?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 ${
        emphasis ? 'border-quadrant-do-now' : 'border-border-strong'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium text-ink">
          {label && <span className="mr-2 text-xs uppercase text-accent">{label}</span>}
          {rock.task}
        </p>
        <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-xs text-muted">
          {rock.when} · {rock.duration}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{rock.why}</p>
    </div>
  )
}
