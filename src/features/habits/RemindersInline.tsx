import { useState } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useHabits, useUpdateHabit, useSoftDeleteHabit, useToggleDailyFlag } from './use-habits'
import { HabitRow } from './HabitRow'
import { useConfirm } from '../../components/use-confirm'
import type { Habit } from '../../types/habit'

// The main-page minified form of Daily reminders: a compact inline row of ACTIVE reminder names,
// each a small hyperlink-like link (the palette has no blue, so this uses the app's interactive
// accent — `primary`). It sits near the top of the work area where the full habits strip used to
// live. The full popup (all reminders + add/queue) is the gear-area RemindersModal; this is the
// glanceable at-a-glance list.
//
// Clicking a name opens a DETAILS modal for THAT single reminder, reusing HabitRow (defaultExpanded)
// as a popup card — checkbox + steps panel + add-step form. It owns only the "which reminder is
// open" selection; all reminder/step reads + writes go through the shared hooks (same as HabitsView),
// so a toggle here and the same toggle in the full popup stay in lockstep via the query cache.

export function RemindersInline() {
  const timeZone = useTimeZone()
  const { data: habits } = useHabits()
  const { data: daily } = useDailyState(timeZone)

  const updateHabit = useUpdateHabit()
  const softDelete = useSoftDeleteHabit()
  const toggleFlag = useToggleDailyFlag()
  const confirm = useConfirm()

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const active = (habits ?? []).filter((h) => h.active)

  // Nothing to surface inline until there's at least one active reminder — stay out of the way.
  if (active.length === 0) return null

  const habitDone = daily?.habit_done ?? {}
  const subtaskDone = daily?.subtask_done ?? {}

  // Resolve the open reminder from the live list so a delete / deactivate elsewhere auto-closes it.
  const selected = active.find((h) => h.id === selectedId) ?? null
  const busy =
    (updateHabit.isPending && updateHabit.variables?.id === selected?.id) ||
    (softDelete.isPending && softDelete.variables === selected?.id)

  const close = () => setSelectedId(null)

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

  const deleteHabit = async (habit: Habit) => {
    if (await confirm({ title: `Delete the reminder "${habit.text}"?` }))
      softDelete.mutate(habit.id, { onSuccess: close })
  }

  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">Reminders</span>
      {active.map((habit) => (
        <button
          key={habit.id}
          type="button"
          onClick={() => setSelectedId(habit.id)}
          className="text-sm text-primary hover:underline"
        >
          {habit.text}
        </button>
      ))}

      {selected && (
        <div
          role="dialog"
          aria-label={`Reminder: ${selected.text}`}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-10"
          onClick={close}
        >
          <section
            className="w-full max-w-md rounded-xl border border-border-strong bg-panel p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold text-ink">Reminder</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close reminder"
                className="text-muted hover:text-ink"
              >
                ✕
              </button>
            </header>

            <ul>
              <HabitRow
                habit={selected}
                habitChecked={Boolean(habitDone[selected.id])}
                subtaskDone={subtaskDone}
                busy={busy}
                defaultExpanded
                onToggleHabit={(checked) => toggleHabit(selected, checked)}
                onToggleSubtask={(subtaskId, checked) =>
                  toggleSubtask(selected, subtaskId, checked)
                }
                onSubtasksChange={(next) => changeSubtasks(selected, next)}
                onDelete={() => deleteHabit(selected)}
              />
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}
