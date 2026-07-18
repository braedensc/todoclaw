import { useState } from 'react'
import type { Task } from '../../types/task'
import { formatStartDay } from '../../lib/start-date'
import { ONGOING_GLYPH } from '../../lib/task-type'

// PausedSection — the ONE place a dormant task (future start_date) is visible in the app: a
// collapsed strip below the list (desktop) and below the quadrant overview (mobile). Everything
// else — grid, ranked list, quadrant counts, Plan My Day, the morning push, reminders — treats a
// dormant task as absent until its start date, so without this strip pausing would read as
// deletion. Collapsed by default (a paused task is deliberately out of the way); the header
// count keeps it discoverable. Rows are read-only except Resume, which clears start_date and
// returns the task to its stored spot immediately — date changes go through BabyClaw or by
// resuming and re-pausing from the row's editor.

export function PausedSection({
  tasks,
  onResume,
}: {
  /** Dormant tasks only (the caller filters with isDormant), any order. */
  tasks: Task[]
  /** Clear the task's start date — it wakes now, at its stored x/y. */
  onResume: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (tasks.length === 0) return null

  // Soonest-returning first, so "what comes back next" heads the list.
  const ordered = [...tasks].sort((a, b) => (a.start_date ?? '').localeCompare(b.start_date ?? ''))

  return (
    <section
      aria-label="Paused tasks"
      className="mt-3 rounded-xl border border-border bg-panel/60 px-4 py-2.5"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[36px] w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[13px] font-semibold text-muted">
          <span aria-hidden>⏸ </span>Paused · {tasks.length}
        </span>
        <span aria-hidden className="text-muted">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="mt-1 flex flex-col">
          {ordered.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 border-t border-border py-2 first:border-t-0"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {t.ongoing && (
                  <span aria-hidden className="mr-1">
                    {ONGOING_GLYPH}
                  </span>
                )}
                {t.text}
              </span>
              {t.start_date && (
                <span className="shrink-0 rounded-full bg-bg px-2 py-0.5 text-[11px] font-semibold text-muted">
                  returns {formatStartDay(t.start_date)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onResume(t.id)}
                aria-label={`Resume ${t.text}`}
                className="shrink-0 rounded-full border border-border-strong bg-card px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink"
              >
                <span aria-hidden>▶</span> Resume
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
