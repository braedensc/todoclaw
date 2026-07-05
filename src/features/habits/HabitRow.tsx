import { useState, type FormEvent } from 'react'
import type { Habit } from '../../types/habit'
import { appendSubtask, removeSubtask, subtaskKey } from './subtasks'

// One ACTIVE habit row: a daily checkbox (habit_done[id]), a steps toggle, and — when
// expanded — the steps (subtasks) panel. Checked state for BOTH the habit and each step comes
// from today's daily_state maps (passed down), so it resets daily and non-destructively: on a
// new local day those maps are empty and everything renders unchecked.
//
// This component owns no server state. It receives today's maps + the mutation callbacks from
// HabitsView and only holds the local "is this row expanded" + draft-step-text UI state.

interface HabitRowProps {
  habit: Habit
  habitChecked: boolean
  // Today's subtask_done map (keyed by the composite "habitId:subtaskId").
  subtaskDone: Record<string, boolean>
  busy: boolean
  onToggleHabit: (checked: boolean) => void
  onToggleSubtask: (subtaskId: string, checked: boolean) => void
  // Patch the habit's embedded subtasks array (add/remove a step).
  onSubtasksChange: (next: Habit['subtasks']) => void
  onDelete: () => void
  // Start with the steps panel open — the single-reminder detail modal reuses this row as a
  // "popup card" and wants the steps/add-step form visible without a click. Defaults to false
  // (the inline list in HabitsView starts collapsed).
  defaultExpanded?: boolean
}

export function HabitRow({
  habit,
  habitChecked,
  subtaskDone,
  busy,
  onToggleHabit,
  onToggleSubtask,
  onSubtasksChange,
  onDelete,
  defaultExpanded = false,
}: HabitRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [stepText, setStepText] = useState('')

  function handleAddStep(e: FormEvent) {
    e.preventDefault()
    const trimmed = stepText.trim()
    if (!trimmed) return
    onSubtasksChange(appendSubtask(habit.subtasks, trimmed))
    setStepText('')
  }

  const stepCount = habit.subtasks.length

  return (
    <li className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <input
          type="checkbox"
          checked={habitChecked}
          onChange={(e) => onToggleHabit(e.target.checked)}
          aria-label={`Mark "${habit.text}" done today`}
          className="h-4 w-4 shrink-0 accent-primary"
        />
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
          {habit.text}
        </span>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={
            expanded ? `Hide steps for "${habit.text}"` : `Show steps for "${habit.text}"`
          }
          className={`shrink-0 rounded border px-2 py-0.5 text-xs ${
            expanded
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border-strong text-muted hover:text-ink'
          }`}
        >
          <span aria-hidden>{expanded ? '▾' : '▸'}</span> steps
          {stepCount > 0 ? ` (${stepCount})` : ''}
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Delete reminder "${habit.text}"`}
          title="Delete this reminder"
          className="shrink-0 rounded px-1.5 py-0.5 text-sm text-muted hover:bg-bg hover:text-accent disabled:opacity-50"
        >
          ×
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-3 py-2">
          {stepCount === 0 ? (
            <p className="mb-2 text-sm text-muted">No steps yet — add one below.</p>
          ) : (
            <ul className="mb-2 space-y-0.5">
              {habit.subtasks.map((subtask) => {
                const checked = Boolean(subtaskDone[subtaskKey(habit.id, subtask.id)])
                return (
                  <li key={subtask.id} className="flex items-center gap-2.5 py-0.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => onToggleSubtask(subtask.id, e.target.checked)}
                      aria-label={`Mark step "${subtask.text}" done today`}
                      className="h-4 w-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{subtask.text}</span>
                    <button
                      type="button"
                      onClick={() => onSubtasksChange(removeSubtask(habit.subtasks, subtask.id))}
                      disabled={busy}
                      aria-label={`Delete step "${subtask.text}"`}
                      title="Delete this step"
                      className="shrink-0 rounded px-2 py-0.5 text-sm text-muted hover:text-accent disabled:opacity-50"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <form onSubmit={handleAddStep} className="flex gap-2">
            <input
              value={stepText}
              onChange={(e) => setStepText(e.target.value)}
              placeholder="Add a step…"
              aria-label={`Add a step to "${habit.text}"`}
              className="flex-1 rounded border border-border-strong bg-card px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </li>
  )
}
