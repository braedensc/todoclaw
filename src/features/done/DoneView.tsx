import { useMemo, type ReactNode } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useTasks } from '../tasks/use-tasks'
import { useDeleteHistoryEntry, useHistory, useRestoreTask } from './use-history'
import { useConfirm } from '../../components/use-confirm'
import { IconButton } from '../../components/IconButton'
import { SleepingPuppy } from '../../components/SleepingPuppy'
import { formatDateTime } from '../../lib/dates'
import { daysUntil } from '../../lib/scoring'
import { quadrantMeta } from '../../lib/quadrants'
import { fmtFrequency, RC_COLOR, recurringStatus } from '../../lib/recurring'
import { DUE_BADGE_MUTED, DUE_BADGE_URGENT } from '../../lib/visual-urgency'
import type { History } from '../../types/history'
import type { Task } from '../../types/task'

// Done tab: the completion history, newest-first. The query already orders by completed_at
// desc, so we render rows as-is. Each row is a mini grid-card: its left accent is the task's
// quadrant color (from x/y), plus a recurring indicator and due badge when applicable — so a
// completion reads like the card it came from.
//
// Restore (↩) is offered for any completion whose underlying task STILL EXISTS (is live, not
// soft-deleted). It calls set_task_undone, which clears TODAY's done flag — the only thing that
// hides a task from the grid — so the task returns to the grid at its stored x/y regardless of
// which day it was completed on. It does NOT touch the history row.
//
// Delete (×) removes THIS completion RECORD from the history list (useDeleteHistoryEntry, an
// owner-scoped hard delete). It does not touch the task. (History used to be append-only and ×
// soft-deleted the task instead, which looked like a no-op — see the done README / ADR-0012.)

// Left-accent for a completion whose task is gone (soft-deleted / no task_id): a muted parchment
// grey, since there is no live x/y to derive a quadrant color from.
const DELETED_ACCENT = '#c9c0ad'

interface HistoryRowProps {
  entry: History
  /** The live task this completion came from, if it still exists (drives the card styling). */
  task: Task | undefined
  timeZone: string
  canRestore: boolean
  onRestore: () => void
  onDelete: () => void
  busy: boolean
}

function HistoryRow({
  entry,
  task,
  timeZone,
  canRestore,
  onRestore,
  onDelete,
  busy,
}: HistoryRowProps) {
  const rc = recurringStatus(task?.recurring)
  const quadrant = task && task.x != null && task.y != null ? quadrantMeta(task.x, task.y) : null
  const days = task ? daysUntil(task.due, { timeZone }) : null
  // Left accent mirrors the grid card's colored top border: recurring tasks carry their
  // RC_COLOR status hue, otherwise the quadrant color for (x, y); a deleted task is neutral.
  const accent = rc ? RC_COLOR[rc.code] : (quadrant?.color ?? DELETED_ACCENT)

  return (
    <li
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
      style={{ borderLeftWidth: 3, borderLeftColor: accent }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {rc && (
            <span
              aria-hidden
              className="shrink-0 rounded-[3px] px-1 py-px text-[9px] font-bold leading-none text-white"
              style={{ backgroundColor: RC_COLOR[rc.code] }}
            >
              ↻
            </span>
          )}
          <span className="truncate text-sm font-medium text-ink">{entry.text}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-light">
          {quadrant && (
            <span
              className="inline-flex items-center gap-1 font-medium"
              style={{ color: quadrant.color }}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: quadrant.color }}
              />
              {quadrant.label}
            </span>
          )}
          {rc && task?.recurring && (
            <span className="font-medium" style={{ color: RC_COLOR[rc.code] }}>
              ↻ {fmtFrequency(task.recurring.frequencyDays)}
            </span>
          )}
          {days !== null && (
            <span
              className="rounded-[3px] px-[5px] py-px font-bold text-white"
              style={{ backgroundColor: days <= 2 ? DUE_BADGE_URGENT : DUE_BADGE_MUTED }}
            >
              {days < 0 ? 'overdue' : days === 0 ? 'due today' : `due ${days}d`}
            </span>
          )}
          <span>{formatDateTime(entry.completed_at)}</span>
        </div>
      </div>

      {canRestore && (
        <IconButton
          variant="neutral"
          onClick={onRestore}
          disabled={busy}
          aria-label={`Restore "${entry.text}"`}
          title="Restore — returns this task to the grid"
        >
          ↩
        </IconButton>
      )}
      <IconButton
        variant="danger"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Delete "${entry.text}"`}
        title="Delete this completion from your history"
      >
        ×
      </IconButton>
    </li>
  )
}

export function DoneView({ onClose }: { onClose?: () => void }) {
  const timeZone = useTimeZone()

  const history = useHistory()
  const restore = useRestoreTask()
  const deleteEntry = useDeleteHistoryEntry()
  const tasks = useTasks()
  const confirm = useConfirm()

  // Live tasks by id — useTasks already excludes soft-deleted rows. A completion is restorable
  // only while its task is still here (set_task_undone can't bring back a soft-deleted task),
  // and the live row is what supplies the mini-card's quadrant / recurring / due styling.
  const liveTaskById = useMemo(
    () => new Map((tasks.data ?? []).map((t) => [t.id, t] as const)),
    [tasks.data],
  )
  const busy = restore.isPending || deleteEntry.isPending

  const handleRestore = (entry: History) => {
    if (!entry.task_id) return
    const taskId = entry.task_id
    // Restoring undoes the completion, so the entry should also leave the Done list — drop the
    // history record once the task is back. Sequenced (delete on restore success) so a restore
    // failure leaves the row intact rather than silently deleting the record.
    restore.mutate({ taskId, timeZone }, { onSuccess: () => deleteEntry.mutate(entry.id) })
  }

  const handleDelete = async (entry: History) => {
    const ok = await confirm({
      title: `Delete “${entry.text}” from your history?`,
      message:
        'This removes the completion record from this list. The task itself is not affected.',
    })
    if (ok) deleteEntry.mutate(entry.id)
  }

  const header = (
    <header className="mb-3 flex items-center justify-between">
      <h2 className="font-serif text-lg font-semibold text-ink">Done</h2>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close done"
          className="rounded text-lg text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
        >
          ✕
        </button>
      )}
    </header>
  )

  let body: ReactNode
  if (history.isLoading) {
    body = <p className="text-muted">Loading…</p>
  } else if (history.isError) {
    body = <p className="text-accent">Couldn’t load your history. Try again.</p>
  } else {
    const entries = history.data ?? []
    body = (
      <>
        <p className="mb-4 text-sm text-muted">
          Your completion history, newest first. <span aria-hidden>↩</span> returns a task to the
          grid (and off this list); <span aria-hidden>×</span> removes the record from this list.
        </p>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-2 text-center">
            <SleepingPuppy className="h-16 w-28 text-muted-light" />
            <p className="text-muted">Nothing done yet — completed tasks land here.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => {
              const task = entry.task_id ? liveTaskById.get(entry.task_id) : undefined
              return (
                <HistoryRow
                  key={entry.id}
                  entry={entry}
                  task={task}
                  timeZone={timeZone}
                  canRestore={Boolean(task)}
                  onRestore={() => handleRestore(entry)}
                  onDelete={() => handleDelete(entry)}
                  busy={busy}
                />
              )
            })}
          </ul>
        )}
      </>
    )
  }

  return (
    <section aria-label="Done" className="rounded-xl border border-border-strong bg-panel p-6">
      {header}
      {body}
    </section>
  )
}
