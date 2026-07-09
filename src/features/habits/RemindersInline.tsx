import { useState } from 'react'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useHabits, useUpdateHabit, useSoftDeleteHabit, useToggleDailyFlag } from './use-habits'
import { HabitRow } from './HabitRow'
import { PawMark } from './HabitCheck'
import { habitDayWrites } from './subtasks'
import { useConfirm } from '../../components/use-confirm'
import { BoneIcon } from '../../components/BoneIcon'
import { BottomSheet } from '../../components/BottomSheet'
import { useIsMobile } from '../../hooks/use-is-mobile'
import type { Habit } from '../../types/habit'

// The main-page minified form of Daily habits — a glanceable "Habit Reminders" list near the top
// of the work area. The full surface (all habits + add/queue) is the Daily habits page
// (RemindersPage, ADR-0027); this is the at-a-glance nudge. Renders NOTHING when there are no
// active habits, so it stays out of the way until there's something to remind about.
//
// Two presentations of the same data (ADR-0028 split):
//   - DESKTOP: a minimal inline row (Variant C) — each habit is a small puppy-blue check + its
//     name, no chip chrome. The check marks it done in place; the name opens the detail card.
//   - MOBILE: a collapsible checklist card (Variant B) — full-width rows (checkbox + name) that are
//     easy to tap, with a header that folds the whole list away and shows the done tally.
//
// In BOTH the check reads today's daily_state habit_done map (resets each local day) and toggles
// via the shared set_daily_flag path, and the name opens a per-habit detail card (HabitRow,
// defaultExpanded) — a centered modal on desktop, a bottom sheet on mobile. It owns only the "which
// habit is open" selection + the mobile collapse state; all data goes through the shared hooks, so
// a toggle here and the same toggle on the Daily habits page stay in lockstep via the query cache.

export function RemindersInline() {
  const timeZone = useTimeZone()
  const { data: habits } = useHabits()
  const { data: daily } = useDailyState(timeZone)

  const updateHabit = useUpdateHabit()
  const softDelete = useSoftDeleteHabit()
  const toggleFlag = useToggleDailyFlag()
  const confirm = useConfirm()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const isMobile = useIsMobile()

  const active = (habits ?? []).filter((h) => h.active)

  // Nothing to surface inline until there's at least one active habit — stay out of the way.
  if (active.length === 0) return null

  const habitDone = daily?.habit_done ?? {}
  const subtaskDone = daily?.subtask_done ?? {}
  const doneCount = active.filter((h) => habitDone[h.id]).length

  // Resolve the open habit from the live list so a delete / deactivate elsewhere auto-closes it.
  const selected = active.find((h) => h.id === selectedId) ?? null
  const busy =
    (updateHabit.isPending && updateHabit.variables?.id === selected?.id) ||
    (softDelete.isPending && softDelete.variables === selected?.id)

  const close = () => setSelectedId(null)

  // The habit check is a master switch: it fans out to every step too (habitDayWrites), same
  // as the Daily habits page, so the two surfaces never disagree on what "done today" means.
  const toggleHabit = (habit: Habit, checked: boolean) =>
    habitDayWrites(habit, checked).forEach((w) => toggleFlag.mutate({ ...w, timeZone }))

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
    if (await confirm({ title: `Remove the habit "${habit.text}"?`, confirmLabel: 'Remove' }))
      softDelete.mutate(habit.id, { onSuccess: close })
  }

  // Done-today tally — rendered as a "treats earned" chip: a little bone + the count, filling
  // solid puppy-blue once every habit is done. Shared by both presentations.
  const allDone = doneCount === active.length
  const tally = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
        allDone ? 'bg-puppy text-white' : 'bg-puppy/10 text-puppy'
      }`}
    >
      <BoneIcon className="h-2 w-auto" />
      {doneCount}/{active.length}
    </span>
  )

  const detail = selected && (
    // One habit's detail card (checkbox + details + add-detail), reused by both surfaces. Opened
    // FROM the home screen, so it stays checkable (that's where habits get ticked off).
    <ul>
      <HabitRow
        habit={selected}
        habitChecked={Boolean(habitDone[selected.id])}
        subtaskDone={subtaskDone}
        busy={busy}
        defaultExpanded
        onToggleHabit={(checked) => toggleHabit(selected, checked)}
        onToggleSubtask={(subtaskId, checked) => toggleSubtask(selected, subtaskId, checked)}
        onSubtasksChange={(next) => changeSubtasks(selected, next)}
        onDelete={() => deleteHabit(selected)}
      />
    </ul>
  )

  return (
    <>
      {isMobile ? (
        // MOBILE — Variant B: a collapsible checklist card. The header folds the list and shows the
        // done tally; each row is a full-width checkbox + name (tap the box to check, the name to
        // open details). Dressed in the puppy palette on warm paper (not a bare white card): bone
        // header mark, paw-print checks, and a faint bone watermark in the card corner.
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-2 py-1.5 text-left"
          >
            <BoneIcon className="h-2.5 w-auto text-puppy/70" />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-light">
              Habit Reminders
            </span>
            {tally}
            <span aria-hidden className="ml-auto text-sm text-muted-light">
              {collapsed ? '▸' : '▾'}
            </span>
          </button>

          {!collapsed && (
            <ul className="relative overflow-hidden rounded-xl border border-puppy/30 bg-panel">
              {/* Watermark — a big bone ghosted into the corner, like a paper stamp. Purely
                  decorative; sits under the rows (they're relative) and steals no taps. */}
              <BoneIcon className="pointer-events-none absolute -bottom-1.5 -right-2 h-10 w-auto -rotate-12 text-puppy opacity-[0.08]" />
              {active.map((habit, i) => {
                const isDone = Boolean(habitDone[habit.id])
                return (
                  <li
                    key={habit.id}
                    className={`relative flex items-center ${i > 0 ? 'border-t border-puppy/15' : ''}`}
                  >
                    <button
                      type="button"
                      aria-pressed={isDone}
                      aria-label={`Mark habit "${habit.text}" done today`}
                      onClick={() => toggleHabit(habit, !isDone)}
                      className="flex shrink-0 items-center py-3 pl-3.5 pr-2"
                    >
                      <PawMark checked={isDone} className="h-6 w-6" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedId(habit.id)}
                      title={`Open habit: ${habit.text}`}
                      className={`min-w-0 flex-1 truncate py-3 pr-3 text-left text-[15px] font-medium ${
                        isDone ? 'text-muted line-through decoration-muted/50' : 'text-ink'
                      }`}
                    >
                      {habit.text}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        // DESKTOP — Variant C: a minimal inline row, no chip chrome. Bone label + paw check + name.
        <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-light">
            <BoneIcon className="h-2.5 w-auto text-puppy/70" />
            Habit Reminders
            {tally}
          </span>
          {active.map((habit) => {
            const isDone = Boolean(habitDone[habit.id])
            return (
              <span key={habit.id} className="inline-flex items-center">
                <button
                  type="button"
                  aria-pressed={isDone}
                  aria-label={`Mark habit "${habit.text}" done today`}
                  title={isDone ? 'Done today — click to undo' : 'Click to mark done today'}
                  onClick={() => toggleHabit(habit, !isDone)}
                  className="flex shrink-0 items-center rounded p-1"
                >
                  <PawMark checked={isDone} className="h-[18px] w-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedId(habit.id)}
                  title={`Open habit: ${habit.text}`}
                  className={`rounded py-1 pl-0.5 pr-1 text-[13px] font-medium transition-colors hover:text-ink ${
                    isDone ? 'text-muted line-through decoration-muted/50' : 'text-ink'
                  }`}
                >
                  {habit.text}
                </button>
              </span>
            )
          })}
        </div>
      )}

      {selected &&
        (isMobile ? (
          // Mobile: a slide-up sheet (swipe/scrim/Escape to dismiss, no ✕).
          <BottomSheet open onClose={close} title="Habit" className="flex max-h-[85dvh] flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{detail}</div>
          </BottomSheet>
        ) : (
          // Desktop: the centered modal card with a ✕ header.
          <div
            role="dialog"
            aria-label={`Habit: ${selected.text}`}
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 pt-[calc(2.5rem_+_env(safe-area-inset-top))]"
            onClick={close}
          >
            <section
              className="w-full max-w-md rounded-xl border border-border-strong bg-panel p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-ink">
                  <BoneIcon className="h-3 w-auto text-puppy/70" />
                  Habit
                </h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close habit"
                  className="text-muted hover:text-ink"
                >
                  ✕
                </button>
              </header>
              {detail}
            </section>
          </div>
        ))}
    </>
  )
}
