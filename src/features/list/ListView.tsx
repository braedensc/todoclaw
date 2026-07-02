import { useTasks, useUpdateTask, useSoftDeleteTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { taskScore } from '../../lib/scoring'
import type { Task } from '../../types/task'
import { ListRow } from './ListRow'

// Priority-ranked list view. Rows are the user's active tasks (soft-deleted rows are already
// excluded by useTasks), MINUS anything marked done today, INCLUDING staged tasks (flagged
// with a "staging" badge). Rows sort by taskScore DESCENDING — importance (y, 0.55) weighted
// above urgency (x, 0.45), with a due-soon bonus (see src/lib/scoring.ts).
//
// All server state comes from the shared hooks; this component owns no task data, only the
// orchestration (filter → sort → render) and the mutation wiring it hands to each row.

export function ListView() {
  const { data: tasks, isLoading, isError } = useTasks()
  const timeZone = useTimeZone()
  const { data: daily } = useDailyState(timeZone)

  const updateTask = useUpdateTask()
  const softDelete = useSoftDeleteTask()
  const markDone = useMarkTaskDone()

  if (isLoading) {
    return (
      <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-muted">Loading…</p>
      </section>
    )
  }

  if (isError || !tasks) {
    return (
      <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-accent">Could not load tasks.</p>
      </section>
    )
  }

  // Exclude tasks already completed today (daily.done is a map of task-id → true). Missing
  // daily state means an empty day → nothing excluded.
  const doneToday = daily?.done ?? {}
  const active = tasks.filter((t) => !doneToday[t.id])

  // Rank by score descending. taskScore treats null x/y as 0.5 internally, so staged tasks
  // sort safely. Sort a copy — never mutate the query cache array.
  const ranked = [...active].sort((a, b) => taskScore(b, { timeZone }) - taskScore(a, { timeZone }))

  if (ranked.length === 0) {
    return (
      <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-muted">No tasks yet — add one from the header.</p>
      </section>
    )
  }

  const handleUpdateText = (id: string, text: string) => updateTask.mutate({ id, patch: { text } })
  const handleUpdateCoords = (id: string, x: number, y: number) =>
    updateTask.mutate({ id, patch: { x, y } })
  const handleUpdateDue = (id: string, due: string | null) =>
    updateTask.mutate({ id, patch: { due } })
  const handleDelete = (id: string) => softDelete.mutate(id)

  // Mark a NORMAL task done: archives it via the Done data-layer RPC (writes today's
  // daily_state.done + appends history in one transaction). It then leaves the list (filtered
  // out by doneToday on the next render) and shows in the Done tab.
  const handleDone = (task: Task) =>
    markDone.mutate({ taskId: task.id, text: task.text, bucket: task.bucket, timeZone })

  // Mark a RECURRING task done: reset its cycle — lastDoneAt=now, doneCount+=1 — via the plain
  // task UPDATE. Deliberately NOT history/daily_state (parity spec: recurring done lives in
  // lastDoneAt). The status flips to "ok" and the card hides from the grid until next cycle.
  const handleDoneRecurring = (task: Task) => {
    if (!task.recurring) return
    updateTask.mutate({
      id: task.id,
      patch: {
        recurring: {
          ...task.recurring,
          lastDoneAt: new Date().toISOString(),
          doneCount: (task.recurring.doneCount ?? 0) + 1,
        },
      },
    })
  }

  // Recurring set/edit/remove — all write the `recurring` jsonb through the shared task UPDATE.
  const handleSetRecurring = (id: string, frequencyDays: number) =>
    updateTask.mutate({
      id,
      patch: { recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 } },
    })
  // Editing the cadence preserves lastDoneAt + doneCount (only the frequency changes).
  const handleSetFrequency = (id: string, frequencyDays: number) => {
    const task = active.find((t) => t.id === id)
    if (!task?.recurring) return
    updateTask.mutate({ id, patch: { recurring: { ...task.recurring, frequencyDays } } })
  }
  const handleRemoveRecurring = (id: string) =>
    updateTask.mutate({ id, patch: { recurring: null } })

  return (
    <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-4">
      <p className="mb-3 text-sm text-muted">
        Ranked by urgency + importance. ↻ = recurring. ▸ to edit values — changes apply on
        release/blur.
      </p>
      <ul className="flex flex-col gap-2">
        {ranked.map((task: Task, i) => (
          <ListRow
            key={task.id}
            task={task}
            rank={i + 1}
            allTasks={active}
            timeZone={timeZone}
            onUpdateText={handleUpdateText}
            onUpdateCoords={handleUpdateCoords}
            onUpdateDue={handleUpdateDue}
            onDone={handleDone}
            onDoneRecurring={handleDoneRecurring}
            onSetRecurring={handleSetRecurring}
            onSetFrequency={handleSetFrequency}
            onRemoveRecurring={handleRemoveRecurring}
            onDelete={handleDelete}
          />
        ))}
      </ul>
    </section>
  )
}
