import { useState } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { RecurringSection } from '../recurring/RecurringSection'

// The expanded detail panel of a list row: urgency/importance sliders (each paired with a
// number input), a due-date picker, a live quadrant badge, and the recurring section
// (set / edit / remove a repeat schedule — src/features/recurring/RecurringSection.tsx).
//
// Slider/number semantics (parity spec "Expanded row"): the controls drive LOCAL state so
// the badge and thumb track the drag live, but x/y are only COMMITTED on pointer-up / blur —
// the grid must not jump while you adjust. Commit goes through `onCommitCoords`, which runs
// collision resolution before writing (see ListRow). The date picker commits `due` on change.

// Data coords are 0–1; the sliders/inputs are 0–100 integers. These convert between them.
const toPercent = (v: number): number => Math.round(v * 100)
const toData = (pct: number): number => pct / 100

interface ExpandedRowProps {
  task: Task
  /** Commit resolved x/y (collision-resolved by the parent) — fired on pointer-up / blur. */
  onCommitCoords: (x: number, y: number) => void
  /** Commit a due date (ISO 'YYYY-MM-DD' or null) — fired on date-picker change. */
  onCommitDue: (due: string | null) => void
  /** Set a fresh recurring schedule of N days (writes `recurring`, lastDoneAt null, count 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule (writes `recurring: null`). */
  onRemoveRecurring: () => void
}

export function ExpandedRow({
  task,
  onCommitCoords,
  onCommitDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
}: ExpandedRowProps) {
  // Local, live coords (percent 0–100). Null x/y default to grid center (50), matching scoring.
  // These initialize from the task once; when a committed write lands and the task coords
  // change, ListRow remounts this panel via a coord-derived `key`, so the initializers re-run
  // from the resolved position — no syncing effect needed.
  const [xPct, setXPct] = useState(() => toPercent(task.x ?? 0.5))
  const [yPct, setYPct] = useState(() => toPercent(task.y ?? 0.5))

  // Badge tracks the LIVE local values, so it updates as the sliders move (parity spec).
  const live = quadrantMeta(toData(xPct), toData(yPct))

  const commit = () => onCommitCoords(toData(xPct), toData(yPct))

  // The date picker wants 'YYYY-MM-DD'; `due` may be a full ISO timestamp, so slice the date.
  const dueValue = task.due ? task.due.slice(0, 10) : ''

  return (
    <div className="border-t border-border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-4">
        <AxisControl
          label="Urgency"
          value={xPct}
          onChange={setXPct}
          onCommit={commit}
          accent="#c2693f"
        />
        <AxisControl
          label="Importance"
          value={yPct}
          onChange={setYPct}
          onCommit={commit}
          accent="#3d7a5f"
        />

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Due</span>
          <input
            type="date"
            aria-label="Due date"
            value={dueValue}
            onChange={(e) => onCommitDue(e.target.value === '' ? null : e.target.value)}
            className="rounded border border-border-strong bg-card px-2 py-1 text-sm"
          />
        </label>

        <span
          className="rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: live.color }}
        >
          {live.label}
        </span>
      </div>

      <RecurringSection
        task={task}
        onSetRecurring={onSetRecurring}
        onSetFrequency={onSetFrequency}
        onRemoveRecurring={onRemoveRecurring}
      />
    </div>
  )
}

interface AxisControlProps {
  label: string
  /** Percent 0–100 (live local value). */
  value: number
  onChange: (pct: number) => void
  /** Fired on pointer-up (slider) / blur (number input) — the commit point. */
  onCommit: () => void
  accent: string
}

// A 0–100 slider paired with a number input, sharing one live value. Both call `onChange`
// live (so the thumb + badge track) but only `onCommit` on pointer-up / blur.
//
// Below `wide` the control takes the full row and the slider flexes to fill it: the fixed
// label+w-32+w-16 trio is wider than a phone card's content box (the "Importance" number input
// used to clip past the card edge at 375px), and a longer track is easier to drag by touch.
function AxisControl({ label, value, onChange, onCommit, accent }: AxisControlProps) {
  const clampPct = (n: number): number => Math.min(100, Math.max(0, n))

  return (
    <div className="flex w-full items-center gap-2 wide:w-auto">
      <span className="shrink-0 text-sm font-medium" style={{ color: accent }}>
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={`${label} slider`}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="min-w-0 flex-1 wide:w-32 wide:flex-none"
      />
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        aria-label={`${label} value`}
        onChange={(e) => onChange(clampPct(Number(e.target.value)))}
        onBlur={onCommit}
        className="w-16 shrink-0 rounded border border-border-strong bg-card px-2 py-1 text-sm"
      />
    </div>
  )
}
