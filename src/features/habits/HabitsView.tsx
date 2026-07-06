import { useState, type FormEvent } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import {
  useHabits,
  useAddHabit,
  useUpdateHabit,
  useSoftDeleteHabit,
  useToggleDailyFlag,
} from './use-habits'
import { HabitRow } from './HabitRow'
import { useConfirm } from '../../components/use-confirm'
import { SleepingPuppy } from '../../components/SleepingPuppy'
import type { Habit } from '../../types/habit'

// Daily reminders — the body of the "Daily reminders" modal (RemindersModal). UI copy says
// "reminders"; the code/table/hooks keep the original "habit" identifiers by design. Parity:
// planning/eisenclaw-export/docs/eisenclaw.md "Daily Habits", pics/Todopic3.jpeg. Two groups:
//   - ACTIVE habits (active === true): expandable rows with a daily checkbox + a steps panel.
//   - QUEUED habits (active === false): dashed "activate" buttons you tap when you're ready to
//     start the habit.
// Plus an add-a-habit input and a per-habit delete.
//
// Habit/step checked-state is read from TODAY's daily_state maps (habit_done / subtask_done),
// so completion resets every local day NON-destructively — a new day reads a different, empty
// daily_state row while the habit rows themselves are untouched. All server state comes from
// the shared hooks; this component owns only the add-habit draft text.

export function HabitsView() {
  const timeZone = useTimeZone()

  const { data: habits, isLoading, isError } = useHabits()
  const { data: daily } = useDailyState(timeZone)

  const addHabit = useAddHabit()
  const updateHabit = useUpdateHabit()
  const softDelete = useSoftDeleteHabit()
  const toggleFlag = useToggleDailyFlag()
  const confirm = useConfirm()

  const [habitText, setHabitText] = useState('')

  // Structural edits (add/remove step, activate, delete) each hit ONE habit — track WHICH so a
  // mutation on one row doesn't disable every other row's controls. Toggling checked-for-today is
  // optimistic (instant, see useToggleDailyFlag), so checkboxes are never disabled at all.
  const pendingHabitId =
    (updateHabit.isPending ? updateHabit.variables?.id : undefined) ??
    (softDelete.isPending ? softDelete.variables : undefined)

  function handleAddHabit(e: FormEvent) {
    e.preventDefault()
    const trimmed = habitText.trim()
    if (!trimmed) return
    addHabit.mutate(trimmed, { onSuccess: () => setHabitText('') })
  }

  if (isLoading) {
    return (
      <section aria-label="Daily reminders">
        <p className="text-sm text-muted">Loading…</p>
      </section>
    )
  }

  if (isError || !habits) {
    return (
      <section aria-label="Daily reminders">
        <p className="text-sm text-accent">Could not load reminders.</p>
      </section>
    )
  }

  const habitDone = daily?.habit_done ?? {}
  const subtaskDone = daily?.subtask_done ?? {}

  const active = habits.filter((h) => h.active)
  const queued = habits.filter((h) => !h.active)

  const toggleHabit = (habit: Habit, checked: boolean) =>
    toggleFlag.mutate({ map: 'habit_done', key: habit.id, value: checked, timeZone })

  const toggleSubtask = (habit: Habit, subtaskId: string, checked: boolean) =>
    toggleFlag.mutate({
      map: 'subtask_done',
      key: `${habit.id}:${subtaskId}`,
      value: checked,
      timeZone,
    })

  const changeSubtasks = (habit: Habit, next: Habit['subtasks']) =>
    updateHabit.mutate({ id: habit.id, patch: { subtasks: next } })

  const activate = (habit: Habit) => updateHabit.mutate({ id: habit.id, patch: { active: true } })

  const deleteHabit = async (habit: Habit) => {
    if (await confirm({ title: `Delete the reminder "${habit.text}"?` }))
      softDelete.mutate(habit.id)
  }

  return (
    // No panel chrome / heading of its own — this renders inside the "Daily reminders" modal
    // (RemindersModal), which supplies the surface and the title. Kept a labeled region for a11y.
    <section aria-label="Daily reminders">
      {active.length === 0 && queued.length === 0 ? (
        <div className="mb-3 flex flex-col items-center gap-1 py-2 text-center">
          <SleepingPuppy className="h-16 w-28 text-muted-light" />
          <p className="text-sm text-muted">No reminders yet — add one below.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {active.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  habitChecked={Boolean(habitDone[habit.id])}
                  subtaskDone={subtaskDone}
                  busy={pendingHabitId === habit.id}
                  onToggleHabit={(checked) => toggleHabit(habit, checked)}
                  onToggleSubtask={(subtaskId, checked) => toggleSubtask(habit, subtaskId, checked)}
                  onSubtasksChange={(next) => changeSubtasks(habit, next)}
                  onDelete={() => deleteHabit(habit)}
                />
              ))}
            </ul>
          )}

          {queued.length > 0 && (
            <div className="mb-3">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                Queued
              </h3>
              <ul className="flex flex-wrap gap-2">
                {queued.map((habit) => (
                  <li key={habit.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => activate(habit)}
                      disabled={pendingHabitId === habit.id}
                      aria-label={`Activate reminder "${habit.text}"`}
                      title="Activate this reminder"
                      className="rounded-lg border border-dashed border-border-strong bg-card px-2.5 py-1 text-sm text-muted hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      + {habit.text}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHabit(habit)}
                      disabled={pendingHabitId === habit.id}
                      aria-label={`Delete reminder "${habit.text}"`}
                      title="Delete this reminder"
                      className="rounded px-1 text-sm text-muted hover:text-accent disabled:opacity-50"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <form onSubmit={handleAddHabit} className="flex gap-2">
        <input
          value={habitText}
          onChange={(e) => setHabitText(e.target.value)}
          placeholder="Add a reminder…"
          aria-label="Add a reminder"
          className="flex-1 rounded border border-border-strong bg-card px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={addHabit.isPending}
          className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </section>
  )
}
