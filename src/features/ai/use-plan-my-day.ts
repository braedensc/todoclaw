import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { daysUntil } from '../../lib/scoring'
import { recurringStatus } from '../../lib/recurring'
import { isDormant } from '../../lib/start-date'
import { workRecency, type WorkRecency } from '../../lib/worked'
import { localDateInTZ } from '../../lib/dates'
import type { DailyStateMaps } from '../daily-state/use-daily-state'
import type { Task, TaskSize } from '../../types/task'
import type { Habit } from '../../types/habit'

// The structured plan the plan-my-day Edge Function returns (mirrors EMIT_PLAN_TOOL there).
// The shape + its Zod validator live in src/types/plan.ts (one source of truth, reused by the
// persisted-plan read boundary too); re-exported here so existing importers keep working.
export type { PlanWhen, PlanRock, DayPlan } from '../../types/plan'
import type { DayPlan } from '../../types/plan'
import { DayPlanSchema } from '../../types/plan'

// Mirror of UPCOMING_WINDOW_DAYS in supabase/functions/_shared/plan-prompt.ts — the frontend build
// tree can't import from the Deno tree, so the value is re-declared here. Keep the two in step: a
// dormant task un-pausing within this many days is surfaced as a "coming up" heads-up.
const UPCOMING_WINDOW_DAYS = 3

// The model-facing wording for an ongoing project's session history — the client mirror of
// workedPhrase in supabase/functions/_shared/worked.ts (same reason as UPCOMING_WINDOW_DAYS above:
// the frontend build tree can't import from the Deno tree). Deliberately NOT workedDetail from
// src/lib/worked.ts: that is the UI sentence ("Worked today · 4 sessions logged"), and the two
// audiences want different things — the planner needs the run length, not the lifetime count.
//
// RAW FACTS ONLY, no verdict word ("resting", "due for a session"): a verdict reads to the model as
// a switch and produces a mechanical every-N-days cadence. A project with no sessions says so —
// "no signal yet" is exactly what the planner has to know about it. Keep in step with the twin.
function workedFact(recency: WorkRecency | null): string {
  if (!recency) return ''
  if (recency.daysSince === null) return 'no sessions logged yet'
  const when = recency.workedToday
    ? 'worked today'
    : recency.daysSince === 1
      ? 'worked yesterday'
      : `last worked ${recency.daysSince} days ago`
  return recency.streak >= 2 ? `${when}, ${recency.streak} days running` : when
}

export interface PlanRequest {
  today: string
  dayOfWeek: string
  tasks: {
    id: string // tasks.id — lets the server tie each emitted rock back to its task (taskId)
    text: string
    importance: number
    urgency: number
    due: string | null
    dueInDays: number | null
    dueTime: string | null
    size: TaskSize | null // coarse effort (S/M/L/XL), or null to let the planner infer it
    ongoing: boolean // a standing project — chip away at it, never must-finish-today
    // Session recency for an ongoing project (empty/false for anything else). workedToday is the one
    // structural pacing rule — the server drops such a project from the rock candidates entirely —
    // and `worked` is the raw fact rendered on its task line.
    workedToday: boolean
    worked: string
  }[]
  // Recurring chores the cadence ladder does NOT call 'ok'. `daysLeft` rides along (<= 0 means
  // wanted today) so the server's "chores due today" strip selects on a number, not on the label.
  recurringDue: { id: string; text: string; status: string; daysLeft: number }[]
  habits: string[]
  // Paused / not-yet-started tasks un-pausing within UPCOMING_WINDOW_DAYS — heads-up material only,
  // never scheduled (they stay OUT of `tasks`).
  upcoming: {
    id: string
    text: string
    startsInDays: number
    startDate: string
    due: string | null
  }[]
}

// Build the request payload from the same data the grid/list use, reusing src/lib scoring +
// recurring so the on-grid filtering and date math live in ONE place. Selection: on-grid =
// not staged, not completed (permanent tasks.completed_at), not done today, not a recurring chore;
// ONGOING projects ARE included (they are placed tasks, flagged so the planner can pace them);
// plus recurring chores that are overdue/due/soon; plus active habits. Pure → unit-tested.
export function buildPlanRequest(
  tasks: Task[],
  habits: Habit[],
  doneMap: Record<string, boolean>,
  timeZone: string,
  now: Date = new Date(),
): PlanRequest {
  const planTasks = tasks
    .filter(
      (t) =>
        !t.staged &&
        !t.completed_at &&
        !doneMap[t.id] &&
        !t.recurring &&
        // Dormant (paused / future start date): never planned — mirrors the server-side gates.
        !isDormant(t, timeZone, now) &&
        t.x != null &&
        t.y != null,
    )
    .map((t) => {
      // Derived here, once, so the request carries finished facts (like importance/dueInDays) and
      // the server only renders them. A project worked TODAY still ships — the server needs it in
      // `tasks` to derive today's fixed-time anchors — flagged so it is dropped from the rock
      // candidates there. Mirrors the server twin, supabase/functions/_shared/plan-inputs.ts.
      const recency = workRecency(t, timeZone, now)
      return {
        id: t.id,
        text: t.text,
        importance: Math.round((t.y ?? 0.5) * 100),
        urgency: Math.round((t.x ?? 0.5) * 100),
        due: t.due,
        dueInDays: daysUntil(t.due, { timeZone, now }),
        dueTime: t.due_time,
        size: t.size ?? null,
        ongoing: t.ongoing,
        workedToday: recency?.workedToday ?? false,
        worked: workedFact(recency),
      }
    })

  const recurringDue: PlanRequest['recurringDue'] = []
  for (const t of tasks) {
    if (!t.recurring) continue
    if (isDormant(t, timeZone, now)) continue // a paused chore sits out its pause too
    const s = recurringStatus(t.recurring, { timeZone, now })
    if (s && s.code !== 'ok') {
      recurringDue.push({ id: t.id, text: t.text, status: s.label, daysLeft: s.daysLeft })
    }
  }

  // Dormant tasks that un-pause SOON (start within UPCOMING_WINDOW_DAYS): NOT scheduled — kept out
  // of `tasks` — but collected as gentle "coming up" heads-ups. Mirrors the server twin in
  // supabase/functions/_shared/plan-inputs.ts. isDormant ⇒ start_date is set and future, so
  // startsInDays >= 1; completed tasks are skipped so a finished-but-paused row can't surface.
  const upcoming: PlanRequest['upcoming'] = []
  for (const t of tasks) {
    if (t.completed_at) continue
    if (!isDormant(t, timeZone, now)) continue
    const startsInDays = daysUntil(t.start_date ?? null, { timeZone, now })
    if (startsInDays != null && startsInDays <= UPCOMING_WINDOW_DAYS) {
      upcoming.push({
        id: t.id,
        text: t.text,
        startsInDays,
        startDate: (t.start_date as string).slice(0, 10),
        due: t.due,
      })
    }
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now)

  return {
    today: fmt({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    dayOfWeek: fmt({ weekday: 'long' }),
    tasks: planTasks,
    recurringDue,
    habits: habits.filter((h) => h.active).map((h) => h.text),
    upcoming,
  }
}

// Calls the plan-my-day Edge Function (server-side Anthropic, owner key). invoke() attaches the
// user's JWT automatically. Throws on any non-2xx (rate-limited / budget-exhausted / failure) —
// the panel reads useAiStatus().paused to show the "AI paused this month" notice proactively.
//
// On success it PERSISTS the plan onto today's daily_state row (via save_daily_plan, keyed by the
// user's LOCAL date) so the inline plan card survives a reload and auto-clears at local midnight,
// then invalidates the daily-state query so the card hydrates from the stored copy. The edge
// function stays stateless — storage is a client-side RPC, mirroring set_daily_flag/set_task_done.
// Persistence is best-effort: if the RPC fails the plan still renders this session (it just won't
// survive a reload), so a storage error is logged, not surfaced as a plan failure.
export function usePlanMyDay(timeZone: string) {
  const queryClient = useQueryClient()
  return useMutation<DayPlan, Error, PlanRequest>({
    mutationFn: async (body) => {
      const { data, error } = await supabase.functions.invoke<{ plan: unknown }>('plan-my-day', {
        body,
      })
      if (error) throw error
      // VALIDATE before returning: this result is both rendered and PERSISTED to daily_state, so an
      // unchecked object becomes a stuck, contentless plan card (a truncated emit once produced a
      // plan with no headline, which rendered as an empty box). A truthiness check is not enough —
      // the malformed object was truthy. Failing here surfaces the card's Retry instead.
      const parsed = DayPlanSchema.safeParse(data?.plan)
      if (!parsed.success || !parsed.data.headline.trim()) throw new Error('No plan returned')
      return parsed.data
    },
    onSuccess: async (plan) => {
      const today = localDateInTZ(timeZone)
      const { error } = await supabase.rpc('save_daily_plan', { p_date: today, p_plan: plan })
      if (error) {
        console.warn('save_daily_plan failed; plan will not survive a reload', error)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['daily_state', today] })
    },
  })
}

// Clears today's persisted plan: writes NULL to daily_state.plan via the SAME save_daily_plan RPC
// (opposite payload), so the inline plan card disappears and STAYS gone across reloads — a real
// clear, not a local hide. onMutate optimistically nulls the cached plan so the card vanishes
// instantly; onSettled invalidates to reconcile with the server (rolling the card back if the RPC
// failed). Hitting "Plan My Day" again regenerates and re-persists a plan. The controller pairs
// this with plan.reset() so a just-generated in-memory result can't out-rank the cleared row.
export function useClearPlan(timeZone: string) {
  const queryClient = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      const today = localDateInTZ(timeZone)
      const { error } = await supabase.rpc('save_daily_plan', { p_date: today, p_plan: null })
      if (error) throw error
    },
    onMutate: () => {
      const today = localDateInTZ(timeZone)
      queryClient.setQueryData<DailyStateMaps | undefined>(['daily_state', today], (old) =>
        old ? { ...old, plan: null } : old,
      )
    },
    onSettled: async () => {
      const today = localDateInTZ(timeZone)
      await queryClient.invalidateQueries({ queryKey: ['daily_state', today] })
    },
  })
}
