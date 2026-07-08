import { useState } from 'react'
import type { Task } from '../../types/task'
import { recurringStatus, RC_COLOR, fmtFrequency } from '../../lib/recurring'

// The "↻ Recurring" control that lives at the bottom of an expanded list row (parity spec
// "Making a task recurring"). It owns no server state — it reads the task's current recurring
// shape and calls back into the parent's mutation wiring (ListView's useUpdateTask) on Set /
// Remove. Pure logic (status code/label, cadence formatting) comes from src/lib/recurring.ts.
//
// Two modes, branched on `task.recurring`:
//  - NOT recurring → a days number-input + a "Set" button (writes a fresh recurring object).
//  - recurring     → the cadence (fmtFrequency) + status (recurringStatus, colored by RC_COLOR),
//    an editable frequency input, and a "Remove" button (writes recurring: null).

interface RecurringSectionProps {
  task: Task
  /** Set a fresh recurring schedule of `frequencyDays` days (lastDoneAt null, doneCount 0). */
  onSetRecurring: (frequencyDays: number) => void
  /** Change the cadence of an already-recurring task, preserving lastDoneAt + doneCount. */
  onSetFrequency: (frequencyDays: number) => void
  /** Drop the recurring schedule — the task becomes a regular one-time task again. */
  onRemoveRecurring: () => void
}

export function RecurringSection({
  task,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
}: RecurringSectionProps) {
  const recurring = task.recurring

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
      <span
        className="font-medium text-muted"
        title="Make this task repeat on a schedule. Marking it done resets the clock instead of archiving it."
      >
        ↻ Recurring
      </span>

      {recurring ? (
        <RecurringActive
          frequencyDays={recurring.frequencyDays}
          status={recurringStatus(recurring)}
          onSetFrequency={onSetFrequency}
          onRemoveRecurring={onRemoveRecurring}
        />
      ) : (
        <RecurringSetup onSet={onSetRecurring} />
      )}
    </div>
  )
}

interface RecurringActiveProps {
  frequencyDays: number
  status: ReturnType<typeof recurringStatus>
  onSetFrequency: (frequencyDays: number) => void
  onRemoveRecurring: () => void
}

// The recurring task's controls: cadence label + live status, an editable frequency, Remove.
function RecurringActive({
  frequencyDays,
  status,
  onSetFrequency,
  onRemoveRecurring,
}: RecurringActiveProps) {
  const accent = status ? RC_COLOR[status.code] : RC_COLOR.ok

  return (
    <>
      <span style={{ color: accent }}>every</span>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={365}
        value={frequencyDays}
        aria-label="Recurring frequency in days"
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 1) onSetFrequency(Math.floor(n))
        }}
        className="w-16 rounded border border-border-strong bg-card px-2 py-1 text-center text-sm"
      />
      {/* Cadence (fmtFrequency) + status label, colored by the status code. */}
      <span className="text-muted">
        days · {fmtFrequency(frequencyDays)}
        {status && (
          <>
            {' · '}
            <span style={{ color: accent }}>{status.label}</span>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onRemoveRecurring}
        title="Remove recurring schedule (becomes a regular one-time task)"
        className="rounded border border-border-strong px-2 py-1 text-muted hover:bg-bg hover:text-ink"
      >
        Remove
      </button>
    </>
  )
}

interface RecurringSetupProps {
  onSet: (frequencyDays: number) => void
}

// The "make this recurring" control: a days input + Set. Owns only its draft input value;
// Set is a no-op until a positive integer is entered (matches EisenClaw's `freq && onSet`).
function RecurringSetup({ onSet }: RecurringSetupProps) {
  const [draft, setDraft] = useState('')

  const submit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 1) {
      onSet(Math.floor(n))
      setDraft('')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={365}
        placeholder="days"
        value={draft}
        aria-label="Days between repeats"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        className="w-20 rounded border border-border-strong bg-card px-2 py-1 text-center text-sm"
      />
      <span className="text-muted">days between repeats</span>
      <button
        type="button"
        onClick={submit}
        className="rounded border px-3 py-1 text-sm font-semibold"
        style={{ borderColor: RC_COLOR.ok, color: RC_COLOR.ok }}
      >
        Set
      </button>
    </div>
  )
}
