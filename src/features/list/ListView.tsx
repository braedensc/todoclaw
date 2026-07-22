import { useTasks, useUpdateTask, useSoftDeleteTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useConfirm } from '../../components/use-confirm'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useNow } from '../../hooks/use-now'
import { useTaskReminders, useTaskReminderWrites } from '../reminders/use-task-reminders'
import { taskScore } from '../../lib/scoring'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import { isDormant } from '../../lib/start-date'
import type { Task } from '../../types/task'
import { ListRow } from './ListRow'
import { PausedSection } from '../tasks/PausedSection'

// Priority-ranked list view. Rows are the user's active tasks (soft-deleted rows are already
// excluded by useTasks), MINUS anything marked done today, INCLUDING not-yet-placed tasks (still
// `staged`, flagged with an "unplaced" badge). Rows sort by taskScore DESCENDING — importance
// (y, 0.55) weighted above urgency (x, 0.45), with a due-soon bonus (see src/lib/scoring.ts).
//
// With `quadrantFilter` set, the SAME machinery renders one Eisenhower quadrant instead of the
// whole list — the per-quadrant "focus" view behind the mobile dual-mode redesign. It scopes only
// which rows RENDER; the collision-context set (`allTasks`) and recurring lookups stay the full
// active set, so a slider commit still avoids every card, not just this quadrant's.
//
// All server state comes from the shared hooks; this component owns no task data, only the
// orchestration (filter → sort → render) and the mutation wiring it hands to each row.

export interface ListViewProps {
  /**
   * When set, render only PLACED tasks whose Eisenhower quadrant (quadrantMeta(x, y).key) matches
   * — the per-quadrant focus list for the mobile overview→focus flow. A staged/unplaced task has
   * no real quadrant, so it is never bucketed here (the mobile overview surfaces those separately).
   * Unset (the default, and the only shape desktop uses) leaves behavior byte-for-byte unchanged:
   * the full ranked list, staged tasks included with their "unplaced" badge.
   */
  quadrantFilter?: QuadrantKey
  /**
   * Optional tap-based reposition callback (mobile focus list only). When set, each row shows a
   * Move control that hands the task up to open the quadrant picker. Desktop passes nothing, so
   * rows are unchanged there.
   */
  onMoveToQuadrant?: (task: Task) => void
}

export function ListView({ quadrantFilter, onMoveToQuadrant }: ListViewProps = {}) {
  const { data: tasks, isLoading, isError } = useTasks()
  const timeZone = useTimeZone()
  // One shared clock for every row's countdown / timed-overdue badge (30s tick — see useNow).
  const now = useNow()
  const { data: daily } = useDailyState(timeZone)

  const updateTask = useUpdateTask()
  const softDelete = useSoftDeleteTask()
  const markDone = useMarkTaskDone()
  // Reminders for every row in one query; the expanded row reads/writes its task's via these. A
  // recurring row's reminders lead each occurrence — same offsets, same picker as a one-off.
  const { data: reminders } = useTaskReminders()
  const reminderWrites = useTaskReminderWrites()
  const confirm = useConfirm()
  // Only for the empty-state copy: the add affordance is the header widget on desktop but the
  // bottom-nav ➕ on a phone — pointing a phone user at a header that isn't there is a dead end.
  const isMobile = useIsMobile()

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

  // Exclude completed tasks. A one-off completion is PERMANENT (task.completed_at, survives the
  // daily reset); today's daily.done map is kept as a same-day belt-and-suspenders hide before
  // the tasks query refetches with completed_at set. Missing daily state = empty day → done map
  // excludes nothing. Dormant tasks (paused / future start_date) are excluded too — they live in
  // the collapsed Paused strip below the list, not in the ranking.
  const doneToday = daily?.done ?? {}
  const live = tasks.filter((t) => !t.completed_at && !doneToday[t.id])
  const active = live.filter((t) => !isDormant(t, timeZone))
  // The full list (not a quadrant focus) is where paused tasks stay findable; a focus list scopes
  // to a quadrant, and a dormant task deliberately has no quadrant presence.
  const paused = quadrantFilter ? [] : live.filter((t) => isDormant(t, timeZone))
  const pausedSection = (
    <PausedSection
      tasks={paused}
      onResume={(id) => updateTask.mutate({ id, patch: { start_date: null } })}
    />
  )

  // Optional per-quadrant scoping (mobile focus view). Only PLACED tasks carry a real quadrant,
  // so a staged task (null x/y) is never in a focus list — on mobile it surfaces in the
  // overview's Unplaced strip (UnplacedSection), whose Place picker materializes it. Unset →
  // `active` unchanged, so the default (desktop) list still ranks staged tasks like any other.
  const scoped = quadrantFilter
    ? active.filter(
        (t) =>
          !t.staged && t.x != null && t.y != null && quadrantMeta(t.x, t.y).key === quadrantFilter,
      )
    : active

  // Rank by score descending. taskScore treats null x/y as 0.5 internally, so staged tasks
  // sort safely. Sort a copy — never mutate the query cache array.
  const ranked = [...scoped].sort((a, b) => taskScore(b, { timeZone }) - taskScore(a, { timeZone }))

  if (ranked.length === 0) {
    // The Paused strip still renders on an otherwise-empty list — a user whose ONLY tasks are
    // paused must be able to find and resume them (hiding it here would read as data loss).
    return (
      <>
        <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-8">
          <p className="text-muted">
            {quadrantFilter
              ? 'Nothing in this quadrant yet.'
              : isMobile
                ? 'No tasks yet — add one with the ➕ below.'
                : 'No tasks yet — add one from the header.'}
          </p>
        </section>
        {pausedSection}
      </>
    )
  }

  const handleUpdateText = (id: string, text: string) => updateTask.mutate({ id, patch: { text } })
  const handleUpdateCoords = (id: string, x: number, y: number) =>
    updateTask.mutate({ id, patch: { x, y } })
  const handleUpdateDue = (id: string, due: string | null, dueTime: string | null) =>
    updateTask.mutate({ id, patch: { due, due_time: dueTime } })
  // Delete now confirms first (was a silent soft-delete). The app-themed useConfirm gate names
  // the task so an accidental click can't quietly remove it; only "Delete" soft-deletes.
  const handleDelete = async (task: Task) => {
    if (
      await confirm({ title: `Delete “${task.text}”?`, message: 'This removes it from your list.' })
    )
      softDelete.mutate(task.id)
  }

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
  // Making a task recurring also clears the ongoing flag (the two types are mutually exclusive), so
  // the SchedulePanel type switch is a single mutation even when crossing from Ongoing → Recurring.
  const handleSetRecurring = (id: string, frequencyDays: number) =>
    updateTask.mutate({
      id,
      patch: { recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 }, ongoing: false },
    })
  // Editing the cadence preserves lastDoneAt + doneCount (only the frequency changes).
  const handleSetFrequency = (id: string, frequencyDays: number) => {
    const task = active.find((t) => t.id === id)
    if (!task?.recurring) return
    updateTask.mutate({ id, patch: { recurring: { ...task.recurring, frequencyDays } } })
  }
  const handleRemoveRecurring = (id: string) =>
    updateTask.mutate({ id, patch: { recurring: null } })

  // Ongoing project: a standalone boolean flag (no recurring data). Setting it true also clears any
  // recurring schedule, keeping the two types exclusive in one mutation. A done ongoing task is
  // archived by the normal handleDone (it has no recurring branch) — there is no separate Finish.
  const handleSetOngoing = (id: string, on: boolean) =>
    updateTask.mutate({ id, patch: on ? { ongoing: true, recurring: null } : { ongoing: false } })

  // Pause (future start date) / resume (null). A paused row leaves the ranking on the next render
  // and reappears in the Paused strip below.
  const handleSetStartDate = (id: string, startDate: string | null) =>
    updateTask.mutate({ id, patch: { start_date: startDate } })

  return (
    <>
      <section aria-label="List" className="rounded-xl border border-border-strong bg-panel p-4">
        <ul className="flex flex-col gap-2">
          {ranked.map((task: Task, i) => (
            <ListRow
              now={now}
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
              onSetOngoing={handleSetOngoing}
              onSetStartDate={handleSetStartDate}
              onDelete={handleDelete}
              onMove={onMoveToQuadrant}
              reminderOffsets={reminders?.get(task.id) ?? []}
              onToggleReminder={(minutes) =>
                reminderWrites.toggle(task.id, minutes, reminders?.get(task.id) ?? [])
              }
              onClearReminders={() => reminderWrites.clear(task.id)}
            />
          ))}
        </ul>
      </section>
      {pausedSection}
    </>
  )
}
