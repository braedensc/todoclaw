import { useState } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
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
      {/* Tighter gap on mobile (gap-2) so the fixed-width rank/badges/status + the 3 action
          buttons still fit a ~375px row without clipping the delete ×; roomier gap-3 ≥720px.
          The heaviest recurring rows (↻ + ×N badge + a long "overdue Nd" status) can still
          exceed a ~320px row even with the text truncated to zero, so on mobile we let the
          action-button cluster wrap to a second line (flex-wrap); desktop stays single-line
          (wide:flex-nowrap), pixel-identical to before. */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 wide:flex-nowrap wide:gap-3">
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
            className="min-w-0 flex-1 rounded border border-border-strong bg-card px-2 py-1 text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(task.text)
              setEditing(true)
            }}
            className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
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

        {/* The three action controls travel as one atomic cluster: on a narrow mobile row the
            whole group wraps to a second line together (ml-auto keeps it right-aligned there)
            rather than the trailing × clipping. On desktop the text button's flex-grow consumes
            all free space, so ml-auto resolves to 0 and the cluster's gap-2/wide:gap-3 matches
            the row — pixel-identical to before. Mirrors GridCard's ActionButton group. */}
        <div className="ml-auto flex shrink-0 items-center gap-2 wide:gap-3">
          {/* Done control. Branches on recurring: a normal task is archived (Done tab + history),
              a recurring task instead resets its clock (no history). Both go through ListView. */}
          <RowAction
            onClick={() => (task.recurring ? onDoneRecurring(task) : onDone(task))}
            aria-label={task.recurring ? 'Mark done (resets clock)' : 'Mark done'}
            title={task.recurring ? 'Done (resets clock)' : 'Mark done'}
          >
            ✓
          </RowAction>

          <RowAction
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse row' : 'Expand row'}
            aria-expanded={expanded}
          >
            {expanded ? '▲' : '▸'}
          </RowAction>

          <RowAction danger onClick={() => onDelete(task.id)} aria-label="Delete task">
            ×
          </RowAction>
        </div>
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

// A fixed 32px (h-8 w-8) square icon button for the row's action affordances (done / expand /
// delete). Routing all three through one shape guarantees they stay the same size, border, and
// alignment — no per-button drift — and keeps the glyph (text-base) centered with no layout
// shift on hover, which only recolors. `danger` swaps the hover accent for the delete control.
// Mirrors GridCard's ActionButton pattern. Extra props (onClick, aria-*, title) pass through.
function RowAction({
  danger = false,
  children,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { danger?: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border-strong text-base leading-none text-muted hover:bg-bg ${
        danger ? 'hover:text-accent' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

// Human-friendly due badge from a calendar-day delta: negative = overdue, 0 = today.
function dueLabel(d: number): string {
  if (d < 0) return `overdue ${Math.abs(d)}d`
  if (d === 0) return 'due today'
  if (d === 1) return 'due tomorrow'
  return `${d}d`
}
