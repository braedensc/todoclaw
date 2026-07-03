import { useMemo } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useSoftDeleteTask, useTasks } from '../tasks/use-tasks'
import { useHistory, useRestoreTask } from './use-history'
import { formatDateTime } from '../../lib/dates'
import type { History } from '../../types/history'

// Done tab: the permanent completion history, newest-first. The query already orders by
// completed_at desc, so we render rows as-is.
//
// Restore is shown ONLY while a completion is still in TODAY's daily_state.done map AND its
// task is still live — see `canRestore`. A previous day's history row can't be un-done; nor
// can one whose task was soft-deleted, because set_task_undone only flips today's `done` and
// never clears `deleted_at`, so restoring a deleted task would be a silent no-op. Restore
// flips today's `done`; it leaves the history row intact (history is append-only).
//
// Delete SOFT-deletes the task (useSoftDeleteTask) — the history row PERSISTS (it is the
// permanent log, denormalized so it survives the task going away). Recurring tasks never
// reach history (they don't write it), so they never appear here.

interface HistoryRowProps {
  entry: History
  canRestore: boolean
  onRestore: () => void
  onDelete: () => void
  busy: boolean
}

function HistoryRow({ entry, canRestore, onRestore, onDelete, busy }: HistoryRowProps) {
  return (
    <li className="flex items-center gap-3 border-l-2 border-primary bg-card px-4 py-3">
      <span aria-hidden className="text-primary">
        ✓
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">{entry.text}</span>
      <span className="shrink-0 text-xs text-muted-light">
        {formatDateTime(entry.completed_at)}
      </span>
      {canRestore && (
        <button
          type="button"
          onClick={onRestore}
          disabled={busy}
          aria-label={`Restore "${entry.text}"`}
          title="Restore — marks this task not done for today"
          className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-bg hover:text-ink disabled:opacity-50"
        >
          ↩
        </button>
      )}
      {entry.task_id && (
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete "${entry.text}"`}
          title="Delete the task (the history record is kept)"
          className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-bg hover:text-accent disabled:opacity-50"
        >
          ×
        </button>
      )}
    </li>
  )
}

export function DoneView() {
  const timeZone = useTimeZone()

  const history = useHistory()
  const daily = useDailyState(timeZone)
  const restore = useRestoreTask()
  const softDelete = useSoftDeleteTask()
  const tasks = useTasks()

  const todayDone = daily.data?.done ?? {}
  // Live task ids — useTasks already filters out soft-deleted rows (deleted_at is null). We
  // gate Restore on this set: set_task_undone only flips today's `done`, it never clears
  // `deleted_at`, so a soft-deleted task can't actually come back. Offering Restore for one
  // would be a silent no-op, so hide it once the task leaves the live set.
  const liveTaskIds = useMemo(() => new Set((tasks.data ?? []).map((t) => t.id)), [tasks.data])
  const busy = restore.isPending || softDelete.isPending

  const handleRestore = (taskId: string | null) => {
    if (!taskId) return
    restore.mutate({ taskId, timeZone })
  }

  const handleDelete = (taskId: string | null, text: string) => {
    if (!taskId) return
    // The history record is permanent; this only soft-deletes the task itself.
    if (!window.confirm(`Delete the task "${text}"? Its completion stays in your history.`)) return
    softDelete.mutate(taskId)
  }

  if (history.isLoading) {
    return (
      <section aria-label="Done" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-muted">Loading…</p>
      </section>
    )
  }

  if (history.isError) {
    return (
      <section aria-label="Done" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-accent">Couldn’t load your history. Try again.</p>
      </section>
    )
  }

  const entries = history.data ?? []

  return (
    <section aria-label="Done" className="rounded-xl border border-border-strong bg-panel p-6">
      <p className="mb-4 text-sm text-muted">
        Your full completion history — permanent. <span aria-hidden>↩</span> restores tasks marked
        done today; <span aria-hidden>×</span> deletes the task (the record stays here).
      </p>

      {entries.length === 0 ? (
        <p className="text-muted">Nothing done yet — completed tasks land here.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <HistoryRow
              key={entry.id}
              entry={entry}
              canRestore={Boolean(
                entry.task_id && todayDone[entry.task_id] && liveTaskIds.has(entry.task_id),
              )}
              onRestore={() => handleRestore(entry.task_id)}
              onDelete={() => handleDelete(entry.task_id, entry.text)}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
