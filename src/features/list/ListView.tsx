import { useTasks, useUpdateTask, useSoftDeleteTask } from '../tasks/use-tasks'
import { useUserSchedule } from '../schedule/use-user-schedule'
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

// Fallback timezone if the schedule row hasn't loaded yet — keeps scoring deterministic and
// NaN-free. The real zone (user_schedule.timezone) drives daysUntil once loaded.
const FALLBACK_TZ = 'UTC'

export function ListView() {
  const { data: tasks, isLoading, isError } = useTasks()
  const { data: schedule } = useUserSchedule()
  const timeZone = schedule?.timezone ?? FALLBACK_TZ
  const { data: daily } = useDailyState(timeZone)

  const updateTask = useUpdateTask()
  const softDelete = useSoftDeleteTask()

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
            onDelete={handleDelete}
          />
        ))}
      </ul>
    </section>
  )
}
