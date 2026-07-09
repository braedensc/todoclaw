import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { daysUntil } from '../../lib/scoring'
import { recurringStatus } from '../../lib/recurring'
import { localDateInTZ } from '../../lib/dates'
import type { DailyStateMaps } from '../daily-state/use-daily-state'
import type { Task } from '../../types/task'
import type { Habit } from '../../types/habit'

// The structured plan the plan-my-day Edge Function returns (mirrors EMIT_PLAN_TOOL there).
// The shape + its Zod validator live in src/types/plan.ts (one source of truth, reused by the
// persisted-plan read boundary too); re-exported here so existing importers keep working.
export type { PlanWhen, PlanRock, DayPlan } from '../../types/plan'
import type { DayPlan } from '../../types/plan'

export interface PlanRequest {
  today: string
  dayOfWeek: string
  tasks: {
    text: string
    importance: number
    urgency: number
    due: string | null
    dueInDays: number | null
    dueTime: string | null
  }[]
  recurringDue: { text: string; status: string }[]
  habits: string[]
}

// Build the request payload from the same data the grid/list use, reusing src/lib scoring +
// recurring so the on-grid filtering and date math live in ONE place. Mirrors EisenClaw's
// planMyDay selection: on-grid = not staged, not done today, not recurring; plus recurring
// chores that are overdue/due/soon; plus active habits. Pure → unit-tested.
export function buildPlanRequest(
  tasks: Task[],
  habits: Habit[],
  doneMap: Record<string, boolean>,
  timeZone: string,
  now: Date = new Date(),
): PlanRequest {
  const planTasks = tasks
    .filter((t) => !t.staged && !doneMap[t.id] && !t.recurring && t.x != null && t.y != null)
    .map((t) => ({
      text: t.text,
      importance: Math.round((t.y ?? 0.5) * 100),
      urgency: Math.round((t.x ?? 0.5) * 100),
      due: t.due,
      dueInDays: daysUntil(t.due, { timeZone, now }),
      dueTime: t.due_time,
    }))

  const recurringDue: { text: string; status: string }[] = []
  for (const t of tasks) {
    if (!t.recurring) continue
    const s = recurringStatus(t.recurring, { now })
    if (s && (s.code === 'overdue' || s.code === 'due' || s.code === 'soon')) {
      recurringDue.push({ text: t.text, status: s.label })
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
      const { data, error } = await supabase.functions.invoke<{ plan: DayPlan }>('plan-my-day', {
        body,
      })
      if (error) throw error
      if (!data?.plan) throw new Error('No plan returned')
      return data.plan
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
