import { useTasks } from '../tasks/use-tasks'
import { useHabits } from '../habits/use-habits'
import { useDailyState } from '../daily-state/use-daily-state'
import { useAiStatus } from './use-ai-status'
import { usePlanMyDay, useClearPlan, buildPlanRequest } from './use-plan-my-day'
import { isPlanRockDone } from '../../lib/plan-done'
import type { DayPlan, PlanRock } from '../../types/plan'

export interface PlanController {
  // The plan to show in the inline card: the fresh mutation result when just generated, otherwise
  // today's persisted plan (daily_state.plan) hydrated on load; null before the first plan.
  displayPlan: DayPlan | null
  paused: boolean
  isPending: boolean
  isError: boolean
  // Whether the header button can fire: data loaded, AI not paused, not already generating.
  canGenerate: boolean
  generate: () => void
  // Dismiss the plan card: persist NULL to today's row (survives reload) and drop any fresh
  // in-memory result. The card reappears only when the user regenerates via the header button.
  clear: () => void
  // Is this rock's task already completed today? The plan card strikes matching rocks through —
  // reactive because it reads the same tasks/daily-state caches every done-marking path updates.
  rockDone: (rock: PlanRock) => boolean
}

// Wires the "Plan My Day" concern for the shell: it pulls the same tasks/habits/daily-state the
// grid uses (react-query dedupes the cache), builds the request with the shared buildPlanRequest,
// and exposes a single generate() for the header button plus the resolved plan/status for the
// inline PlanBox. Generation is user-triggered (no auto-run) — the card shows its empty state
// until the button is tapped, and rehydrates a same-day plan from daily_state on reload.
export function usePlanController(timeZone: string): PlanController {
  const tasksQ = useTasks()
  const habitsQ = useHabits()
  const dailyQ = useDailyState(timeZone)
  const status = useAiStatus()
  const plan = usePlanMyDay(timeZone)
  const clearPlan = useClearPlan(timeZone)

  const paused = status.data?.paused ?? false
  const dataReady = !tasksQ.isLoading && !habitsQ.isLoading && !dailyQ.isLoading
  const canGenerate = dataReady && !paused && !plan.isPending

  const generate = () => {
    if (!canGenerate) return
    plan.mutate(
      buildPlanRequest(tasksQ.data ?? [], habitsQ.data ?? [], dailyQ.data?.done ?? {}, timeZone),
    )
  }

  const clear = () => {
    // Drop the fresh mutation result first so displayPlan can't keep showing it; clearPlan then
    // nulls the persisted row (optimistically + on the server) so the card stays gone on reload.
    plan.reset()
    clearPlan.mutate()
  }

  return {
    displayPlan: plan.data ?? dailyQ.data?.plan ?? null,
    paused,
    isPending: plan.isPending,
    isError: plan.isError,
    canGenerate,
    generate,
    clear,
    rockDone: (rock) => isPlanRockDone(rock, tasksQ.data ?? [], dailyQ.data?.done ?? {}, timeZone),
  }
}
