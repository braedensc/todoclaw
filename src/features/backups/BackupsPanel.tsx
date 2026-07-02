import { useBackups, useCreateBackup, useRestoreBackup } from './use-backups'
import { useTasks } from '../tasks/use-tasks'
import { useHabits } from '../habits/use-habits'
import { formatDateTime } from '../../lib/dates'
import { buildPlannerExport, downloadJson, exportFilename } from './export-json'

// Backups panel — a modal overlay (z-50 so it covers the mobile bottom tab bar, per ADR-0020).
// Lists the user's server-side snapshots newest-first with Create / Restore, plus a client-side
// "Download JSON" export for portability. Snapshot + restore are RPCs (see use-backups); this
// component is presentation + a restore confirmation.

export function BackupsPanel({ onClose }: { onClose: () => void }) {
  const backups = useBackups()
  const create = useCreateBackup()
  const restore = useRestoreBackup()
  const tasks = useTasks()
  const habits = useHabits()

  const busy = create.isPending || restore.isPending
  const entries = backups.data ?? []

  function handleExport() {
    downloadJson(exportFilename(), buildPlannerExport(tasks.data ?? [], habits.data ?? []))
  }

  function handleRestore(id: string) {
    // Restore soft-deletes tasks/habits added since the snapshot (recoverable) and rewinds the
    // schedule; history is never touched. Confirm because it moves current items to trash.
    const ok = window.confirm(
      'Restore this snapshot? Tasks and habits added since then are moved to trash (recoverable), ' +
        'and your schedule is restored to the snapshot. Your completion history is kept.',
    )
    if (ok) restore.mutate(id)
  }

  return (
    <div
      role="dialog"
      aria-label="Backups"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-16"
      onClick={onClose}
    >
      <section
        className="w-full max-w-md rounded-xl border border-border-strong bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Backups</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close backups"
            className="text-muted hover:text-ink"
          >
            ✕
          </button>
        </header>

        <p className="mb-4 text-sm text-muted">
          Snapshot your tasks, habits, and schedule — or download a JSON copy. Restoring brings a
          snapshot back; your completion history is always kept.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => create.mutate(undefined)}
            disabled={busy}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create backup'}
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="rounded border border-border-strong px-4 py-2 text-sm font-medium text-ink hover:bg-bg"
          >
            Download JSON
          </button>
        </div>

        {(create.isError || restore.isError) && (
          <p className="mb-3 text-sm text-accent">Something went wrong — please try again.</p>
        )}

        {backups.isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted">No backups yet — create one above.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((b) => (
              <li
                key={b.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {b.label ?? formatDateTime(b.created_at)}
                  {b.label && (
                    <span className="ml-2 text-xs text-muted-light">
                      {formatDateTime(b.created_at)}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleRestore(b.id)}
                  disabled={busy}
                  aria-label={`Restore backup from ${formatDateTime(b.created_at)}`}
                  className="shrink-0 rounded px-3 py-1 text-sm font-medium text-primary hover:bg-bg disabled:opacity-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
