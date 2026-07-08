import { useState } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useHabits, useUpdateHabit, useSoftDeleteHabit, useToggleDailyFlag } from './use-habits'
import { HabitRow } from './HabitRow'
import { useConfirm } from '../../components/use-confirm'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/use-is-mobile'
import type { Habit } from '../../types/habit'

// The main-page minified form of Daily reminders: a compact inline row of ACTIVE reminder pills,
// near the top of the work area where the full habits strip used to live. The full surface (all
// reminders + add/queue) is the Reminders page (RemindersPage, ADR-0027); this is the glanceable
// at-a-glance list.
//
// Each pill is two touch targets sharing one rounded shell:
//   - a state indicator on the left — a hollow ring when NOT done today, a filled ✓ when done —
//     that ALSO marks the reminder done/undone in place (no need to open anything). Done today is
//     read from today's daily_state habit_done map, so it resets each local day.
//   - the reminder name on the right, which opens a DETAILS modal for THAT single reminder, reusing
//     HabitRow (defaultExpanded) as a popup card — checkbox + steps panel + add-step form.
//
// It owns only the "which reminder is open" selection; all reminder/step reads + writes go through
// the shared hooks (same as HabitsView), so a toggle here and the same toggle in the full popup (or
// on the Reminders page) stay in lockstep via the query cache.

export function RemindersInline() {
  const timeZone = useTimeZone()
  const { data: habits } = useHabits()
  const { data: daily } = useDailyState(timeZone)

  const updateHabit = useUpdateHabit()
  const softDelete = useSoftDeleteHabit()
  const toggleFlag = useToggleDailyFlag()
  const confirm = useConfirm()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isMobile = useIsMobile()

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
    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-light">
        Reminders
      </span>
      {active.map((habit) => {
        const isDone = Boolean(habitDone[habit.id])
        return (
          <span
            key={habit.id}
            className={`inline-flex items-center rounded-full border transition-colors ${
              isDone ? 'border-primary/50 bg-primary/15' : 'border-primary/30 bg-primary/10'
            }`}
          >
            {/* State indicator + mark-done-in-place. Hollow ring = not done, filled ✓ = done today;
                tapping toggles today's done flag (same set_daily_flag path as the detail card). */}
            <button
              type="button"
              aria-pressed={isDone}
              aria-label={`Mark reminder "${habit.text}" done today`}
              title={isDone ? 'Done today — tap to undo' : 'Tap to mark done today'}
              onClick={() => toggleHabit(habit, !isDone)}
              className="flex shrink-0 items-center rounded-l-full py-3 pl-3.5 pr-2 hover:bg-primary/15 wide:py-1 wide:pl-2.5 wide:pr-1.5"
            >
              <span
                aria-hidden
                className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold leading-none transition-colors wide:h-4 wide:w-4 wide:text-[10px] ${
                  isDone
                    ? 'border-primary bg-primary text-white'
                    : 'border-primary/50 text-transparent'
                }`}
              >
                ✓
              </span>
            </button>

            {/* Name → per-reminder detail card (checkbox + steps + delete). */}
            <button
              type="button"
              onClick={() => setSelectedId(habit.id)}
              title={`Open reminder: ${habit.text}`}
              className={`rounded-r-full py-3 pl-1 pr-3.5 text-[13px] font-medium transition-colors hover:bg-primary/15 wide:py-1 wide:pr-2.5 wide:text-xs ${
                isDone ? 'text-muted line-through decoration-muted/50' : 'text-primary'
              }`}
            >
              {habit.text}
            </button>
          </span>
        )
      })}

      {selected &&
        (() => {
          // One reminder's detail card (checkbox + steps + add-step), reused by both surfaces.
          const detail = (
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
          )

          // Mobile: a slide-up sheet (swipe/scrim/Escape to dismiss, no ✕).
          if (isMobile) {
            return (
              <BottomSheet
                open
                onClose={close}
                title="Reminder"
                className="flex max-h-[85dvh] flex-col"
              >
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{detail}</div>
              </BottomSheet>
            )
          }

          // Desktop: the centered modal card with a ✕ header (unchanged).
          return (
            <div
              role="dialog"
              aria-label={`Reminder: ${selected.text}`}
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[calc(2.5rem_+_env(safe-area-inset-top))]"
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
                {detail}
              </section>
            </div>
          )
        })()}
    </div>
  )
}
