import { useState } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { daysUntil } from '../../lib/scoring'
import { recurringStatus, RC_COLOR, fmtFrequency } from '../../lib/recurring'
import { resolveCollision } from '../../lib/collision'
import { ExpandedRow } from './ExpandedRow'

// A single ranked list row. Reads pure logic from src/lib (quadrant color, due/recurring
// badges) and writes through the mutation callbacks the parent supplies (text edit, x/y
// commit, due commit, done, recurring set/edit/remove, soft delete). All write hooks live in
// the parent (ListView) so this component stays presentational + locally-stateful (edit
// buffer, expanded toggle).
//
// The done control branches on recurring (parity spec / EisenClaw `toggleDone`): a NORMAL
// task goes to the Done tab + history (onDone), a RECURRING task instead resets its cycle
// (onDoneRecurring) — no history, no daily_state. Both handlers live in ListView.

// The `×N` recurring count badge appears once a recurring task has been completed this many
// times — mirrors the grid card (src/features/grid/grid-constants.ts RECURRING_BADGE_MIN_DONE).
const RECURRING_BADGE_MIN_DONE = 3

interface ListRowProps {
  task: Task
  rank: number
  /** All active tasks — passed to resolveCollision so the committed spot avoids overlaps. */
  allTasks: Task[]
  timeZone: string
  onUpdateText: (id: string, text: string) => void
  onUpdateCoords: (id: string, x: number, y: number) => void
  onUpdateDue: (id: string, due: string | null) => void
  /** Mark a NORMAL task done (Done tab + history). Recurring tasks use onDoneRecurring. */
  onDone: (task: Task) => void
  /** Mark a RECURRING task done — resets its cycle (lastDoneAt/doneCount), no history. */
  onDoneRecurring: (task: Task) => void
  /** Make the task recurring with the given cadence (writes a fresh `recurring`). */
  onSetRecurring: (id: string, frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (id: string, frequencyDays: number) => void
  /** Drop the recurring schedule (writes `recurring: null`). */
  onRemoveRecurring: (id: string) => void
  onDelete: (id: string) => void
}

export function ListRow({
  task,
  rank,
  allTasks,
  timeZone,
  onUpdateText,
  onUpdateCoords,
  onUpdateDue,
  onDone,
  onDoneRecurring,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onDelete,
}: ListRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)

  // Null x/y (staged tasks) fall back to grid center for the quadrant color, matching scoring.
  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const due = daysUntil(task.due, { timeZone })
  const status = recurringStatus(task.recurring)
  const showCount = task.recurring != null && task.recurring.doneCount >= RECURRING_BADGE_MIN_DONE

  function commitText() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== task.text) {
      onUpdateText(task.id, trimmed)
    } else {
      setDraft(task.text) // revert empty/unchanged edits to the canonical text
    }
  }

  // Slider commit: resolve the target against all active tasks (skips self), then write the
  // non-overlapping spot. Collision runs ONLY here, never live (parity spec).
  function handleCommitCoords(x: number, y: number) {
    const resolved = resolveCollision(x, y, allTasks, task.id)
    onUpdateCoords(task.id, resolved.x, resolved.y)
  }

  return (
    <li
      className="overflow-hidden rounded-lg border border-border bg-card"
      style={{ borderLeft: `4px solid ${quadrant.color}` }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="w-8 shrink-0 text-sm font-semibold tabular-nums"
          style={{ color: quadrant.color }}
          aria-label={`Rank ${rank}`}
        >
          #{rank}
        </span>

        {/* Recurring glyph badge — tooltip carries cadence + status (parity spec). */}
        {status && (
          <span
            className="shrink-0 rounded border px-1 text-sm"
            style={{ color: RC_COLOR[status.code], borderColor: RC_COLOR[status.code] }}
            title={`${fmtFrequency(task.recurring?.frequencyDays ?? 0)} · ${status.label}`}
            aria-label={`Recurring, ${status.label}`}
          >
            ↻
          </span>
        )}

        {/* Recurring completion count — mirrors the grid card's ×N badge at doneCount >= 3. */}
        {showCount && (
          <span
            className="shrink-0 text-xs font-semibold text-muted"
            aria-label={`Completed ${task.recurring?.doneCount} times`}
          >
            ×{task.recurring?.doneCount}
          </span>
        )}

        {editing ? (
          <input
            autoFocus
            value={draft}
            aria-label="Edit task text"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitText()
              if (e.key === 'Escape') {
                setDraft(task.text)
                setEditing(false)
              }
            }}
            className="flex-1 rounded border border-border-strong bg-card px-2 py-1 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(task.text)
              setEditing(true)
            }}
            className="flex-1 truncate text-left text-sm text-ink hover:underline"
            title="Click to edit"
          >
            {task.text}
          </button>
        )}

        {/* Staged tasks have no grid position yet — flag them so they read as not-yet-placed. */}
        {task.staged && (
          <span className="shrink-0 rounded bg-muted-faint px-2 py-0.5 text-xs font-medium text-ink">
            staging
          </span>
        )}

        {/* For recurring tasks the recurring status replaces the plain due badge. */}
        {status ? (
          <span className="shrink-0 text-xs font-medium" style={{ color: RC_COLOR[status.code] }}>
            {status.label}
          </span>
        ) : (
          due !== null && (
            <span className="shrink-0 rounded bg-bg px-2 py-0.5 text-xs font-medium text-muted">
              {dueLabel(due)}
            </span>
          )
        )}

        {/* Done control. Branches on recurring: a normal task is archived (Done tab + history),
            a recurring task instead resets its clock (no history). Both go through ListView. */}
        <button
          type="button"
          onClick={() => (task.recurring ? onDoneRecurring(task) : onDone(task))}
          aria-label={task.recurring ? 'Mark done (resets clock)' : 'Mark done'}
          title={task.recurring ? 'Done (resets clock)' : 'Mark done'}
          className="shrink-0 rounded border border-border-strong px-2 py-1 text-sm text-muted hover:bg-bg hover:text-ink"
        >
          ✓
        </button>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse row' : 'Expand row'}
          aria-expanded={expanded}
          className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-bg"
        >
          {expanded ? '▲' : '▸'}
        </button>

        <button
          type="button"
          onClick={() => onDelete(task.id)}
          aria-label="Delete task"
          className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-bg hover:text-accent"
        >
          ×
        </button>
      </div>

      {expanded && (
        <ExpandedRow
          // Remount when committed coords change so the panel re-reads the resolved position
          // from props (its local slider state initializes from the task once per mount).
          key={`${task.x}:${task.y}`}
          task={task}
          onCommitCoords={handleCommitCoords}
          onCommitDue={(d) => onUpdateDue(task.id, d)}
          onSetRecurring={(freq) => onSetRecurring(task.id, freq)}
          onSetFrequency={(freq) => onSetFrequency(task.id, freq)}
          onRemoveRecurring={() => onRemoveRecurring(task.id)}
        />
      )}
    </li>
  )
}

// Human-friendly due badge from a calendar-day delta: negative = overdue, 0 = today.
function dueLabel(d: number): string {
  if (d < 0) return `overdue ${Math.abs(d)}d`
  if (d === 0) return 'due today'
  if (d === 1) return 'due tomorrow'
  return `${d}d`
}
