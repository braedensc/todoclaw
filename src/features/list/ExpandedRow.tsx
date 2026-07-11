import { useState } from 'react'
import type { Task } from '../../types/task'
import { quadrantMeta } from '../../lib/quadrants'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { SchedulePanel } from '../schedule/SchedulePanel'

// The expanded detail panel of a list row: urgency/importance sliders (each paired with a
// number input), a live quadrant badge, and the shared SchedulePanel (two-week calendar +
// time chips + remind + repeats — the ONE schedule editor, workshop 2026-07-09). On mobile
// this panel IS the task editor (no grid below 720px), so the schedule controls take the
// touch size grade there.
//
// Slider/number semantics (parity spec "Expanded row"): the controls drive LOCAL state so
// the badge and thumb track the drag live, but x/y are only COMMITTED on pointer-up / blur —
// the grid must not jump while you adjust. Commit goes through `onCommitCoords`, which runs
// collision resolution before writing (see ListRow). Schedule edits commit instantly through
// the same callback contracts the old inline pickers used.

// Data coords are 0–1; the sliders/inputs are 0–100 integers. These convert between them.
const toPercent = (v: number): number => Math.round(v * 100)
const toData = (pct: number): number => pct / 100

interface ExpandedRowProps {
  task: Task
  /** IANA timezone — anchors the SchedulePanel calendar ("today" = the user's day). */
  timeZone: string
  /** Commit resolved x/y (collision-resolved by the parent) — fired on pointer-up / blur. */
  onCommitCoords: (x: number, y: number) => void
  /** Commit due date + time ('YYYY-MM-DD' / 'HH:MM', null to clear) — fired on picker change.
   *  Always writes both columns: clearing the date clears the time with it (a time without a
   *  date is rejected by the DB CHECK). */
  onCommitDue: (due: string | null, dueTime: string | null) => void
  /** Set a fresh recurring schedule of N days (writes `recurring`, lastDoneAt null, count 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change an already-recurring task's cadence (preserves lastDoneAt + doneCount). */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule (writes `recurring: null`). */
  onRemoveRecurring: () => void
  /** Enter the row's inline text edit — the mobile-visible Rename chip (audit §4.1): the row's
   *  other edit gestures are double-click (mouse) and F2 (keyboard), neither reachable by touch. */
  onRename: () => void
  /** This task's selected reminder offsets (minutes before due); empty = none. Shown once a due
   *  time exists. Multi-select. */
  reminderOffsets: readonly number[]
  /** Toggle one reminder lead time on/off. */
  onToggleReminder: (minutes: number) => void
  /** Clear every reminder on this task (the Off chip). */
  onClearReminders: () => void
}

export function ExpandedRow({
  task,
  timeZone,
  onCommitCoords,
  onCommitDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onRename,
  reminderOffsets,
  onToggleReminder,
  onClearReminders,
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

  // Below 720px this panel is the ONLY editor — thumb-sized schedule controls there.
  const isMobile = useIsMobile()

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

        <span
          className="rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: live.color }}
        >
          {live.label}
        </span>

        {/* Rename — the touch path into the row's inline text edit. Hidden at `wide:` where
            double-click / F2 already cover it and the chip would just be noise. */}
        <button
          type="button"
          onClick={onRename}
          className="rounded border border-border-strong px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-bg hover:text-ink wide:hidden"
        >
          <span aria-hidden>✎</span> Rename
        </button>
      </div>

      {/* The ONE schedule editor — same panel as the grid card's ⋯ menu and the add surfaces,
          so a due date reads and edits identically everywhere. Width-capped so the calendar
          keeps wall-calendar proportions inside a wide desktop row. */}
      <div className="mt-3 max-w-[340px]">
        <SchedulePanel
          taskText={task.text}
          due={task.due}
          dueTime={task.due_time}
          recurring={task.recurring}
          timeZone={timeZone}
          onSetDue={onCommitDue}
          onSetRecurring={onSetRecurring}
          onSetFrequency={onSetFrequency}
          onRemoveRecurring={onRemoveRecurring}
          reminderOffsets={reminderOffsets}
          onToggleReminder={onToggleReminder}
          onClearReminders={onClearReminders}
          idPrefix="list"
          touch={isMobile}
        />
      </div>
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
        inputMode="numeric"
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
