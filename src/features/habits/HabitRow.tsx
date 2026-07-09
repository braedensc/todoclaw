import { useState, type FormEvent } from 'react'
import type { Habit } from '../../types/habit'
import { HabitCheckbox } from './HabitCheck'
import { appendSubtask, removeSubtask, subtaskKey } from './subtasks'

// One habit row, in two modes (the `checkable` prop):
//   - checkable=true  — the HOME detail popup (RemindersInline): a daily checkbox + name, plus an
//     expandable "details" panel whose sub-items are each checkable. This is where a habit gets
//     ticked off for the day.
//   - checkable=false — the SETUP page (HabitsView): a MANAGEMENT row — no daily checkbox at all
//     (habits are only checked off from the home screen). The details toggle sits to the LEFT of
//     the name and the delete is a clear "Remove" button. Details are edited here, not ticked.
//
// "Details" are the habit's optional sub-steps (stored as `subtasks`; the daily maps keep the
// original `subtask_done` key). Checked state for both the habit and each detail comes from
// today's daily_state maps (passed down), so it resets daily and non-destructively.
//
// This component owns no server state — it receives today's maps + the mutation callbacks and
// holds only the local "is this row expanded" + draft-detail-text UI state.

interface HabitRowProps {
  habit: Habit
  habitChecked: boolean
  // Today's subtask_done map (keyed by the composite "habitId:subtaskId").
  subtaskDone: Record<string, boolean>
  busy: boolean
  onToggleHabit: (checked: boolean) => void
  onToggleSubtask: (subtaskId: string, checked: boolean) => void
  // Patch the habit's embedded subtasks array (add/remove a detail).
  onSubtasksChange: (next: Habit['subtasks']) => void
  onDelete: () => void
  // Whether the habit + its details show daily checkboxes. True on the home detail popup (where a
  // habit is ticked off), false on the setup page (management only). Default true.
  checkable?: boolean
  // Start with the details panel open — the home detail popup reuses this row as a "popup card"
  // and wants the details/add-detail form visible without a click. Defaults to false (the setup
  // list starts collapsed).
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
  checkable = true,
  defaultExpanded = false,
}: HabitRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [detailText, setDetailText] = useState('')

  function handleAddDetail(e: FormEvent) {
    e.preventDefault()
    const trimmed = detailText.trim()
    if (!trimmed) return
    onSubtasksChange(appendSubtask(habit.subtasks, trimmed))
    setDetailText('')
  }

  const detailCount = habit.subtasks.length

  // The disclosure control for the details panel — same button in both modes; only its placement
  // differs (left of the name on the setup page, right of it in the checkable popup).
  const detailsToggle = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={
        expanded ? `Hide details for "${habit.text}"` : `Show details for "${habit.text}"`
      }
      className={`shrink-0 rounded border px-2.5 py-2 text-xs wide:px-2 wide:py-0.5 ${
        expanded
          ? 'border-puppy bg-puppy/10 text-puppy'
          : 'border-border-strong text-muted hover:text-ink'
      }`}
    >
      <span aria-hidden>{expanded ? '▾' : '▸'}</span> Details
      {detailCount > 0 ? ` (${detailCount})` : ''}
    </button>
  )

  // Remove-the-habit control. In the compact popup it's a bare ✕; on the setup page it's a clearer
  // outlined "Remove" button (the ask was for an unambiguous remove affordance there).
  const removeButton = checkable ? (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label={`Remove habit "${habit.text}"`}
      title="Remove this habit"
      className="shrink-0 rounded px-2.5 py-1.5 text-base text-muted hover:bg-bg hover:text-accent disabled:opacity-50 wide:px-1.5 wide:py-0.5 wide:text-sm"
    >
      ×
    </button>
  ) : (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label={`Remove habit "${habit.text}"`}
      title="Remove this habit"
      className="shrink-0 rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-muted hover:border-accent hover:bg-accent/5 hover:text-accent disabled:opacity-50"
    >
      Remove
    </button>
  )

  return (
    // Habit surfaces wear the puppy palette on warm paper (not the stark white/green defaults) —
    // the same look as the inline home list, so opening a habit never shifts palette.
    <li className="rounded-lg border border-puppy/30 bg-gradient-to-br from-puppy/[0.07] to-card">
      <div className="flex items-center gap-2 px-3 py-2 wide:gap-2.5">
        {checkable ? (
          // HOME popup: [checkbox + name] … [details] [×]. Checkbox + name share one <label> so on
          // a phone the whole text line toggles the day's check (mobile audit §2.2).
          <>
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1.5 wide:py-0">
              <HabitCheckbox
                checked={habitChecked}
                onChange={(e) => onToggleHabit(e.target.checked)}
                ariaLabel={`Mark "${habit.text}" done today`}
                className="h-6 w-6 wide:h-5 wide:w-5"
              />
              <span
                className={`min-w-0 flex-1 truncate text-base font-semibold ${
                  habitChecked ? 'text-muted line-through decoration-muted/50' : 'text-ink'
                }`}
              >
                {habit.text}
              </span>
            </label>
            {detailsToggle}
            {removeButton}
          </>
        ) : (
          // SETUP page: [details] name … [Remove]. Details toggle leads (left of the name), no daily
          // checkbox — habits are only ticked off from the home screen.
          <>
            {detailsToggle}
            <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">
              {habit.text}
            </span>
            {removeButton}
          </>
        )}
      </div>

      {expanded && (
        <div className="border-t border-puppy/20 px-3 py-2">
          {detailCount === 0 ? (
            <p className="mb-2 text-sm text-muted">
              Details are optional — add sub-steps only if you want to track parts of this habit.
            </p>
          ) : (
            <ul className="mb-2 space-y-0.5">
              {habit.subtasks.map((subtask) => {
                const checked = Boolean(subtaskDone[subtaskKey(habit.id, subtask.id)])
                return (
                  <li key={subtask.id} className="flex items-center gap-2.5 py-0.5">
                    {checkable ? (
                      // Same label-wrap as the habit line: tap the detail text to check it off.
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1 wide:py-0">
                        <HabitCheckbox
                          checked={checked}
                          onChange={(e) => onToggleSubtask(subtask.id, e.target.checked)}
                          ariaLabel={`Mark detail "${subtask.text}" done today`}
                          className="h-5 w-5 wide:h-[18px] wide:w-[18px]"
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            checked ? 'text-muted line-through decoration-muted/50' : 'text-ink'
                          }`}
                        >
                          {subtask.text}
                        </span>
                      </label>
                    ) : (
                      // Setup page: details are managed, not ticked — plain text + a remove control.
                      <span className="min-w-0 flex-1 truncate py-1 text-sm text-ink wide:py-0">
                        {subtask.text}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onSubtasksChange(removeSubtask(habit.subtasks, subtask.id))}
                      disabled={busy}
                      aria-label={`Remove detail "${subtask.text}"`}
                      title="Remove this detail"
                      className="shrink-0 rounded px-2.5 py-1.5 text-base text-muted hover:text-accent disabled:opacity-50 wide:px-2 wide:py-0.5 wide:text-sm"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <form onSubmit={handleAddDetail} className="flex gap-2">
            <input
              value={detailText}
              onChange={(e) => setDetailText(e.target.value)}
              placeholder="Add a detail…"
              aria-label={`Add a detail to "${habit.text}"`}
              enterKeyHint="done"
              className="min-w-0 flex-1 rounded border border-border-strong bg-card px-3 py-1.5 text-sm"
            />
            {/* Secondary (outlined) — deliberately NOT the solid "Add habit" button, so the two
                add controls never read as the same action (they used to be identical). */}
            <button
              type="submit"
              disabled={busy}
              className="shrink-0 rounded-md border border-puppy/60 px-3 py-1.5 text-sm font-medium text-puppy hover:bg-puppy/10 disabled:opacity-50"
            >
              + Add detail
            </button>
          </form>
        </div>
      )}
    </li>
  )
}
