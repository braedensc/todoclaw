import { useState } from 'react'
import type { Task } from '../../types/task'
import { BottomSheet } from '../../components/BottomSheet'
import { SchedulePanel } from '../schedule/SchedulePanel'
import { quadrantMeta } from '../../lib/quadrants'
import { RC_COLOR, recurringStatus } from '../../lib/recurring'
import {
  dueChipStyle,
  gridChipLabel,
  pausedChipLabel,
  staleBadge,
  staleness,
  urgencyTier,
} from '../../lib/visual-urgency'

export interface TouchTaskSheetProps {
  /** The task whose actions are open, or null (sheet closed). */
  task: Task | null
  /** Dormant (paused) task — read-only except the schedule path (Resume) and delete. */
  paused: boolean
  daysUntilDue: number | null
  minutesUntilDue: number | null
  timeZone: string
  reminderOffsets: readonly number[]
  onClose: () => void
  /** Mark done (caller branches recurring vs one-off) — caller also closes the sheet. */
  onDone: () => void
  /** Delete — confirm-gated by the caller (convention: the confirm lives with the mutation). */
  onDelete: () => void
  onRename: (text: string) => void
  /** Enter tap-to-place move mode — the caller closes the sheet and arms the canvas. */
  onMove: () => void
  onSetDue: (due: string | null, dueTime: string | null) => void
  onSetRecurring: (frequencyDays: number) => void
  onSetFrequency: (frequencyDays: number) => void
  onRemoveRecurring: () => void
  onSetOngoing: (on: boolean) => void
  onSetStartDate: (startDate: string | null) => void
  onToggleReminder: (minutes: number) => void
  onClearReminders: () => void
}

/**
 * The touch grid's per-task action sheet — where a chip's tap lands. Carries every control the
 * desktop GridCard offers, at thumb size: Done / Schedule (the shared SchedulePanel, inline
 * behind a disclosure) / Move (tap-to-place) / Delete, plus tap-the-title rename. Presentation
 * follows MoveToQuadrantSheet (open derived from `task != null`, caller owns all writes) and
 * DoneSheet (ariaLabel + own header; capped height with an internal scroller, since the
 * schedule panel makes it tall).
 */
export function TouchTaskSheet({
  task,
  paused,
  daysUntilDue,
  minutesUntilDue,
  timeZone,
  reminderOffsets,
  onClose,
  onDone,
  onDelete,
  onRename,
  onMove,
  onSetDue,
  onSetRecurring,
  onSetFrequency,
  onRemoveRecurring,
  onSetOngoing,
  onSetStartDate,
  onToggleReminder,
  onClearReminders,
}: TouchTaskSheetProps) {
  // Transient per-task state (rename draft, schedule disclosure). No reset effect needed: the
  // caller keys this component by task id, so switching tasks (or closing, key 'none') remounts
  // it with fresh state — the set-state-in-effect-free reset pattern.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)

  // BottomSheet renders nothing while closed anyway; returning null keeps the tree tidy. (All
  // hooks above run unconditionally, so the early return is rules-of-hooks safe.)
  if (!task) return null

  const quadrant = quadrantMeta(task.x ?? 0.5, task.y ?? 0.5)
  const rc = recurringStatus(task.recurring)
  const stale = rc || paused ? null : staleness(task, daysUntilDue)
  const tier = rc || stale || paused ? 'none' : urgencyTier(daysUntilDue, minutesUntilDue)
  const frost = stale ? staleBadge(stale) : null

  const commitRename = () => {
    const text = draft.trim()
    if (text && text !== task.text) onRename(text)
    setEditing(false)
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      ariaLabel={`Task: ${task.text}`}
      className="flex max-h-[85dvh] flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Title — tap to rename inline (the touch stand-in for the card's double-click). */}
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                // Stop the keydown here or BottomSheet's document-level Escape handler closes
                // the whole sheet — backing out of the edit should return to the read view.
                e.stopPropagation()
                setEditing(false)
              }
            }}
            aria-label="Task name"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 font-medium text-ink"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(task.text)
              setEditing(true)
            }}
            title="Tap to rename"
            className="flex min-h-[44px] w-full items-center text-left"
          >
            <span className="font-medium text-ink">{task.text}</span>
            <span aria-hidden className="ml-1.5 text-xs text-muted-faint">
              ✎
            </span>
          </button>
        )}

        {/* Meta line: quadrant + the same one status chip the chip surface shows. */}
        <div className="mb-3 mt-1 flex items-center gap-2 text-xs text-muted">
          <span className="font-semibold uppercase tracking-wide" style={{ color: quadrant.color }}>
            {quadrant.label}
          </span>
          {paused ? (
            <span>{pausedChipLabel(task.start_date)}</span>
          ) : frost ? (
            <span title={frost.title}>{frost.chip}</span>
          ) : rc ? (
            <span style={{ color: RC_COLOR[rc.code] }}>↻ {rc.label}</span>
          ) : tier !== 'none' && daysUntilDue !== null ? (
            <span className="rounded px-1 font-semibold" style={dueChipStyle(tier)}>
              {gridChipLabel(tier, daysUntilDue, task.due_time, minutesUntilDue)}
            </span>
          ) : null}
        </div>

        {/* Action row — 44pt targets. Paused tasks are read-only on the board: no Done/Move;
            Schedule stays (it is the Resume path) and Delete stays. */}
        <div className="flex gap-2">
          {!paused && (
            <button
              type="button"
              onClick={onDone}
              className="min-h-[44px] flex-1 rounded-xl border border-primary bg-card text-sm font-semibold text-primary"
            >
              ✓ Done{rc ? ' (resets clock)' : ''}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowSchedule((s) => !s)}
            aria-expanded={showSchedule}
            className="min-h-[44px] flex-1 rounded-xl border border-border-strong bg-card text-sm font-semibold text-ink"
          >
            ⋯ Schedule
          </button>
          {!paused && (
            <button
              type="button"
              onClick={onMove}
              className="min-h-[44px] flex-1 rounded-xl border border-puppy/60 bg-card text-sm font-semibold text-puppy"
            >
              ⇢ Move
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete task"
            className="min-h-[44px] w-[52px] rounded-xl border border-border-strong bg-card text-base font-semibold text-danger"
          >
            ×
          </button>
        </div>

        {!paused && (
          <div className="mt-2 text-center text-[10px] text-muted">
            Press and hold a card on the grid to drag it — ⇢ Move taps a spot instead.
          </div>
        )}

        {showSchedule && (
          <div className="mt-3 border-t border-border pt-3">
            <SchedulePanel
              taskText={task.text}
              due={task.due}
              dueTime={task.due_time}
              recurring={task.recurring}
              ongoing={task.ongoing}
              startDate={task.start_date}
              timeZone={timeZone}
              touch
              idPrefix="touch"
              reminderOffsets={reminderOffsets}
              onSetDue={onSetDue}
              onSetRecurring={onSetRecurring}
              onSetFrequency={onSetFrequency}
              onRemoveRecurring={onRemoveRecurring}
              onSetOngoing={onSetOngoing}
              onSetStartDate={onSetStartDate}
              onToggleReminder={onToggleReminder}
              onClearReminders={onClearReminders}
            />
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
