import { useCallback, useState } from 'react'
import { useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useHabits } from '../habits/use-habits'
import { useDailyState } from '../daily-state/use-daily-state'
import { useMarkTaskDone, useRestoreTask } from '../done/use-history'
import { useAiStatus } from './use-ai-status'
import { usePlanMyDay, useClearPlan, buildPlanRequest } from './use-plan-my-day'
import { findPlanTask, isPlanRockDone } from '../../lib/plan-done'
import { recurringCompletion, recurringRestore } from '../../lib/recurring'
import { localDateInTZ } from '../../lib/dates'
import type { PlanItemCheck } from './PlanBox'
import type { DayPlan, PlanRock } from '../../types/plan'

// The (task text, taskId) pair every checkable plan item carries — a rock, a fixed-time anchor, or
// a due chore. Enough to find the item's task on the board; see findPlanTask.
type PlanItemRef = Pick<PlanRock, 'task' | 'taskId'>

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
  // Takes the (task, taskId) pair only, so the card can strike fixed-time anchors through too.
  rockDone: (rock: PlanItemRef) => boolean
  // Check this item off (or back on) straight from the plan card — the same writes the board's ✓
  // makes, so the two surfaces stay one source of truth. Returns null when the item has nothing to
  // toggle: no task on the board matches it (a model-invented item, or one deleted since planning).
  itemCheck: (item: PlanItemRef) => PlanItemCheck | null
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
  // The three writes behind the card's checkboxes — the same hooks the grid/list ✓ use.
  const markDone = useMarkTaskDone()
  const restore = useRestoreTask()
  const updateTask = useUpdateTask()

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

  const tasks = tasksQ.data ?? []
  const doneMap = dailyQ.data?.done ?? {}
  const rockDone = (rock: PlanItemRef) => isPlanRockDone(rock, tasks, doneMap, timeZone)

  // Which task has a check-off write in flight right now. Read straight off the mutations' own
  // `variables` rather than tracked separately, so a tapped box can show itself busy (and refuse a
  // second tap — set_task_done appends a history row per call) with no extra state to keep in sync.
  const busyTaskId = markDone.isPending
    ? markDone.variables?.taskId
    : restore.isPending
      ? restore.variables?.taskId
      : updateTask.isPending
        ? updateTask.variables?.id
        : null

  // Check an item off / back on. Branches exactly like the grid and list ✓ do:
  //   • a normal task is archived (set_task_done → today's done map + history + completed_at), and
  //     un-checking restores it (set_task_undone) — the same write the Done tab's ↩ makes;
  //   • a recurring chore advances its cycle instead (lastDoneAt=now, any one-shot nextDueOn
  //     consumed) and never touches history; un-checking rewinds that stamp by one cadence
  //     (recurringRestore), so the chore reads due again from where it actually stood.
  const itemCheck = (item: PlanItemRef): PlanItemCheck | null => {
    const task = findPlanTask(item, tasks)
    if (!task) return null
    const done = rockDone(item)
    const busy = task.id === busyTaskId
    const recurring = task.recurring
    if (recurring) {
      if (done) {
        const rewound = recurringRestore(recurring)
        // Null for a never-completed chore (nothing to rewind) — leave the box inert rather than
        // firing a write that can't mean anything.
        if (!rewound) return null
        return {
          busy,
          toggle: () => updateTask.mutate({ id: task.id, patch: { recurring: rewound } }),
        }
      }
      // Stamped inside the click, not at render: lastDoneAt must be when the user checked it off.
      return {
        busy,
        toggle: () =>
          updateTask.mutate({ id: task.id, patch: { recurring: recurringCompletion(recurring) } }),
      }
    }
    return {
      busy,
      toggle: () =>
        done
          ? restore.mutate({ taskId: task.id, timeZone })
          : markDone.mutate({ taskId: task.id, text: task.text, bucket: task.bucket, timeZone }),
    }
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
    rockDone,
    itemCheck,
  }
}
