import type { Task } from '../../types/task'
import { ONGOING_GLYPH } from '../../lib/task-type'

// UnplacedSection — the mobile home for staged (not-yet-placed) tasks. On desktop those live in
// the "Drag new item to grid" tray (TaskInputWidget), which mobile never renders — so a task
// created without a position (e.g. BabyClaw's create_task with no urgency/importance) used to be
// invisible on a phone: skipped by the quadrant buckets AND filtered out of every focus list.
// This strip sits below the quadrant overview; each row's "Place" opens the Move-to-quadrant
// sheet — the tap-based stand-in for the desktop tray drag. Unlike the Paused strip it is always
// expanded: a paused task is deliberately parked, an unplaced one is waiting on the user.

export function UnplacedSection({
  tasks,
  onPlace,
}: {
  /** Unplaced tasks only (the caller filters with isUnplaced), any order. */
  tasks: Task[]
  /** Open the quadrant picker for this task — picking materializes it (x/y + staged:false). */
  onPlace: (task: Task) => void
}) {
  if (tasks.length === 0) return null

  // Newest first: the most likely reason this strip is showing is a task just created via chat.
  const ordered = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at))

  return (
    <section
      aria-label="Unplaced tasks"
      className="mt-3 rounded-xl border border-border bg-panel/60 px-4 py-2.5"
    >
      <p className="flex min-h-[36px] items-center text-[13px] font-semibold text-muted">
        <span aria-hidden>📥 </span>Unplaced · {tasks.length}
      </p>
      <ul className="flex flex-col">
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
            <button
              type="button"
              onClick={() => onPlace(t)}
              aria-label={`Place ${t.text}`}
              className="shrink-0 rounded-full border border-border-strong bg-card px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-ink"
            >
              <span aria-hidden>📍</span> Place
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
