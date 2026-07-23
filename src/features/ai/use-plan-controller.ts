import { useCallback, useState } from 'react'
import { useTasks } from '../tasks/use-tasks'
import { useHabits } from '../habits/use-habits'
import { useDailyState } from '../daily-state/use-daily-state'
import { useAiStatus } from './use-ai-status'
import { usePlanMyDay, useClearPlan, buildPlanRequest } from './use-plan-my-day'
import { isPlanRockDone } from '../../lib/plan-done'
import { localDateInTZ } from '../../lib/dates'
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
  // Collapse the plan card to a one-line summary WITHOUT deleting it (distinct from clear/dismiss).
  // A pure view preference — the plan stays in daily_state and re-expands on demand. Persisted
  // device-local, keyed by the local date so it auto-resets at midnight like the plan itself.
  collapsed: boolean
  toggleCollapsed: () => void
  // Is this rock's task already completed today? The plan card strikes matching rocks through —
  // reactive because it reads the same tasks/daily-state caches every done-marking path updates.
  rockDone: (rock: PlanRock) => boolean
}

// Device-local persistence for the collapsed view-preference. Keyed by the local date so a stale
// "collapsed" from yesterday can't hide today's fresh plan; falls back gracefully if storage throws
// (private mode / disabled) — collapse just won't survive reload then.
const COLLAPSE_KEY = 'tc.planCollapsed'
function readCollapsed(today: string): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { date?: string; collapsed?: boolean }
    return parsed.date === today && parsed.collapsed === true
  } catch {
    return false
  }
}
function writeCollapsed(today: string, collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ date: today, collapsed }))
  } catch {
    /* storage unavailable — collapse stays in-memory only */
  }
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

  const today = localDateInTZ(timeZone)
  const [collapsed, setCollapsed] = useState(() => readCollapsed(today))
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      writeCollapsed(today, next)
      return next
    })
  }, [today])

  const generate = () => {
    if (!canGenerate) return
    // A freshly generated plan should show expanded — clear any lingering collapsed preference.
    setCollapsed(false)
    writeCollapsed(today, false)
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
    collapsed,
    toggleCollapsed,
    rockDone: (rock) => isPlanRockDone(rock, tasksQ.data ?? [], dailyQ.data?.done ?? {}, timeZone),
  }
}
