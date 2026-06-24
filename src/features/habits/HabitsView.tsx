import { useState, type FormEvent } from 'react'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useDailyState } from '../daily-state/use-daily-state'
import {
  useHabits,
  useAddHabit,
  useUpdateHabit,
  useSoftDeleteHabit,
  useToggleDailyFlag,
} from './use-habits'
import { HabitRow } from './HabitRow'
import type { Habit } from '../../types/habit'

// Daily Habits tab (parity: planning/eisenclaw-export/docs/eisenclaw.md "Daily Habits",
// pics/Todopic3.jpeg). Two groups:
//   - ACTIVE habits (active === true): expandable rows with a daily checkbox + a steps panel.
//   - QUEUED habits (active === false): dashed "activate" buttons you tap when you're ready to
//     start the habit.
// Plus an add-a-habit input and a per-habit delete.
//
// Habit/step checked-state is read from TODAY's daily_state maps (habit_done / subtask_done),
// so completion resets every local day NON-destructively — a new day reads a different, empty
// daily_state row while the habit rows themselves are untouched. All server state comes from
// the shared hooks; this component owns only the add-habit draft text.

// Fallback timezone until the schedule row loads — keeps localDateInTZ deterministic so the
// daily_state read/write target the same date key on first paint.
const FALLBACK_TZ = 'UTC'

export function HabitsView() {
  const { data: schedule } = useUserSchedule()
  const timeZone = schedule?.timezone ?? FALLBACK_TZ

  const { data: habits, isLoading, isError } = useHabits()
  const { data: daily } = useDailyState(timeZone)

  const addHabit = useAddHabit()
  const updateHabit = useUpdateHabit()
  const softDelete = useSoftDeleteHabit()
  const toggleFlag = useToggleDailyFlag()

  const [habitText, setHabitText] = useState('')

  const busy = toggleFlag.isPending || updateHabit.isPending || softDelete.isPending

  function handleAddHabit(e: FormEvent) {
    e.preventDefault()
    const trimmed = habitText.trim()
    if (!trimmed) return
    addHabit.mutate(trimmed, { onSuccess: () => setHabitText('') })
  }

  if (isLoading) {
    return (
      <section aria-label="Habits" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-muted">Loading…</p>
      </section>
    )
  }

  if (isError || !habits) {
    return (
      <section aria-label="Habits" className="rounded-xl border border-border-strong bg-panel p-8">
        <p className="text-accent">Could not load habits.</p>
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

  const deleteHabit = (habit: Habit) => {
    if (!window.confirm(`Delete the habit "${habit.text}"?`)) return
    softDelete.mutate(habit.id)
  }

  return (
    <section aria-label="Habits" className="rounded-xl border border-border-strong bg-panel p-6">
      <header className="mb-4">
        <h2 className="font-serif text-2xl font-semibold text-ink">Daily habits</h2>
        <p className="text-sm text-muted">
          Check them off as you go — resets each morning. <span aria-hidden>▸</span> expand to add
          steps.
        </p>
      </header>

      {active.length === 0 && queued.length === 0 ? (
        <p className="text-muted">No habits yet — add one below.</p>
      ) : (
        <>
          {active.length > 0 && (
            <ul className="mb-4 space-y-3">
              {active.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  habitChecked={Boolean(habitDone[habit.id])}
                  subtaskDone={subtaskDone}
                  busy={busy}
                  onToggleHabit={(checked) => toggleHabit(habit, checked)}
                  onToggleSubtask={(subtaskId, checked) => toggleSubtask(habit, subtaskId, checked)}
                  onSubtasksChange={(next) => changeSubtasks(habit, next)}
                  onDelete={() => deleteHabit(habit)}
                />
              ))}
            </ul>
          )}

          {queued.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-muted">Queued</h3>
              <ul className="flex flex-wrap gap-2">
                {queued.map((habit) => (
                  <li key={habit.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => activate(habit)}
                      disabled={busy}
                      aria-label={`Activate habit "${habit.text}"`}
                      title="Activate this habit"
                      className="rounded-lg border border-dashed border-border-strong bg-card px-3 py-2 text-sm text-muted hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      + {habit.text}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHabit(habit)}
                      disabled={busy}
                      aria-label={`Delete habit "${habit.text}"`}
                      title="Delete this habit"
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
          placeholder="Add a habit…"
          aria-label="Add a habit"
          className="flex-1 rounded border border-border-strong bg-card px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={addHabit.isPending}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </section>
  )
}
