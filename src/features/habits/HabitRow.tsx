import { useState, type FormEvent } from 'react'
import type { Habit } from '../../types/habit'
import { HabitCheckbox, PawGlyph } from './HabitCheck'
import { appendSubtask, removeSubtask, subtaskKey } from './subtasks'

// One habit row, in two modes (the `checkable` prop):
//   - checkable=true  — the HOME detail popup (RemindersInline): a daily checkbox + name, plus an
//     expandable "details" panel whose sub-items are each checkable. This is where a habit gets
//     ticked off for the day.
//   - checkable=false — the SETUP popup (HabitsView): a MANAGEMENT row — no daily checkbox at all
//     (habits are only checked off from the home screen). Details are edited here, not ticked, and
//     each one is bulleted with a little blue paw instead of a checkbox.
//
// The disclosure control is a PAW that tilts open (not a chevron); "Add detail" sits at the top of
// the panel, styled as a sibling of the paw toggle but clearly a different action.
//
// "Details" are the habit's optional sub-steps (stored as `subtasks`; the daily maps keep the
// original `subtask_done` key). Checked state for both the habit and each detail comes from today's
// daily_state maps (passed down), so it resets daily and non-destructively.
//
// This component owns no server state — it receives today's maps + the mutation callbacks and holds
// only the local "is this row expanded" + draft-detail-text UI state.

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
  // habit is ticked off), false on the setup popup (management only). Default true.
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

  // The disclosure control — a paw that tilts to the right when the panel opens (instead of a
  // rotating chevron). Same button in both modes; only its placement differs (left of the name on
  // the setup popup, right of it in the checkable popup).
  const detailsToggle = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={
        expanded ? `Hide details for "${habit.text}"` : `Show details for "${habit.text}"`
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        expanded
          ? 'border-puppy bg-puppy/10 text-puppy'
          : 'border-border-strong text-muted hover:border-puppy/60 hover:text-puppy'
      }`}
    >
      <PawGlyph
        className={`h-4 w-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${
          expanded ? 'rotate-[24deg] text-puppy' : 'rotate-0'
        }`}
      />
      Details{detailCount > 0 ? ` (${detailCount})` : ''}
    </button>
  )

  // Remove-the-habit control — destructive, so it wears the brick-red `danger` token. In the compact
  // popup it's a small ✕; on the setup popup it's a clearer outlined "Remove" button.
  const removeButton = checkable ? (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label={`Remove habit "${habit.text}"`}
      title="Remove this habit"
      className="shrink-0 rounded px-2.5 py-1.5 text-base text-muted hover:bg-danger/10 hover:text-danger disabled:opacity-50 wide:px-2 wide:py-1"
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
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:border-danger hover:bg-danger/10 disabled:opacity-50"
    >
      Remove
    </button>
  )

  // The "Add detail" trigger form — pinned to the TOP-LEFT of the panel, under the paw toggle. Same
  // paw family as the toggle, but dashed + a "＋" lead so it reads as a different action.
  const addDetailForm = (
    <form onSubmit={handleAddDetail} className="mb-2.5 flex items-center gap-2">
      <input
        value={detailText}
        onChange={(e) => setDetailText(e.target.value)}
        placeholder="Add a detail…"
        aria-label={`Add a detail to "${habit.text}"`}
        enterKeyHint="done"
        className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-sm wide:max-w-xs"
      />
      <button
        type="submit"
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-puppy/60 px-2.5 py-1.5 text-xs font-medium text-puppy hover:bg-puppy/10 disabled:opacity-50"
      >
        <span aria-hidden className="text-sm leading-none">
          ＋
        </span>{' '}
        Add detail
      </button>
    </form>
  )

  return (
    // Habit surfaces wear the puppy palette on warm paper (not the stark white/green defaults) —
    // the same look as the inline home list, so opening a habit never shifts palette.
    <li className="rounded-lg border border-puppy/30 bg-gradient-to-br from-puppy/[0.07] to-card">
      <div className="flex items-center gap-2.5 px-3.5 py-3 wide:gap-3 wide:py-2.5">
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
          // SETUP popup: [details] name … [Remove]. Paw toggle leads (left of the name), no daily
          // checkbox — habits are only ticked off from the home screen.
          <>
            {detailsToggle}
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink wide:text-base">
              {habit.text}
            </span>
            {removeButton}
          </>
        )}
      </div>

      {expanded && (
        <div className="border-t border-puppy/20 px-3.5 py-3">
          {addDetailForm}

          {detailCount === 0 ? (
            <p className="text-sm text-muted">
              Details are optional — add sub-steps only if you want to track parts of this habit.
            </p>
          ) : (
            <ul className="space-y-0.5">
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
                      // Setup popup: details are managed, not ticked — a little blue paw bullet + text.
                      <span className="flex min-w-0 flex-1 items-center gap-2.5 py-1 text-sm text-ink wide:py-0.5">
                        <PawGlyph className="h-3.5 w-3.5 shrink-0 text-puppy" />
                        <span className="min-w-0 flex-1 truncate">{subtask.text}</span>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onSubtasksChange(removeSubtask(habit.subtasks, subtask.id))}
                      disabled={busy}
                      aria-label={`Remove detail "${subtask.text}"`}
                      title="Remove this detail"
                      className="shrink-0 rounded px-2 py-1 text-base text-muted hover:text-danger disabled:opacity-50 wide:text-sm"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
