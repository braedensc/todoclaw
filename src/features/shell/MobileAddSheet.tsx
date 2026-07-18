import { useRef } from 'react'
import { useTasks, useAddTask } from '../tasks/use-tasks'
import type { QuadrantKey } from '../../lib/quadrants'
import type { Recurring } from '../../types/task'
import { placeInQuadrant } from '../../lib/quadrant-summary'
import { BottomSheet } from '../../components/BottomSheet'
import { AddTaskForm } from './AddTaskForm'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useTaskReminderWrites } from '../reminders/use-task-reminders'
import { effectiveReminderDefault } from '../reminders/reminder-offsets'

// MobileAddSheet — the single mobile "add a task" surface, opened by the bottom nav's "+".
// Reworked (2026-07-08 feedback): a true SLIDE-UP bottom sheet, not a full-screen takeover —
// content-sized, home stays visible behind the scrim, and it dismisses like every other sheet
// (body swipe-down / scrim tap / Escape). The keyboard does NOT auto-open: BottomSheet focuses
// the panel itself (no initialFocusRef), so typing starts only when the user taps the field.
//
// The form (AddTaskForm) produces a PLACED task: text + a quadrant (framed as "how urgent +
// important?"), plus an optional Repeats schedule (daily / weekly / every N days) — dropped at
// the quadrant's center (collision-resolved) with staged:false. Manual-only by design; the form
// carries a 🐾 tip pointing at Chat (BabyClaw) as the fastest capture path, wired here to close
// this sheet and open the chat.
//
// `defaultQuadrant` pre-selects the quadrant the user is already looking at (use-quadrant-focus).
// `onAdded` reports the destination up so App can flash the "Added to …" confirmation.

export function MobileAddSheet({
  open,
  defaultQuadrant,
  onAdded,
  onOpenChat,
  onClose,
}: {
  open: boolean
  defaultQuadrant: QuadrantKey | null
  onAdded?: (dest: QuadrantKey) => void
  /** Opens the BabyClaw chat (the form's "fastest way to add" tip). */
  onOpenChat?: () => void
  onClose: () => void
}) {
  const { data: tasks } = useTasks()
  const addTask = useAddTask()
  const reminderWrites = useTaskReminderWrites()
  const reminderDefault = effectiveReminderDefault(
    useUserSchedule().data?.config.notifications?.reminderDefaultMinutes,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  // Manual add → placed task. Collision-resolve the quadrant center against existing placed
  // tasks; Repeats and Due (date + optional time) ship on the same insert; a timed task with a
  // chosen reminder offset gets its reminder once the row exists (it FKs the task id) — recurring
  // tasks included (the reminder now leads each occurrence).
  const handleAdd = (
    text: string,
    dest: QuadrantKey,
    recurring: Recurring | null,
    ongoing: boolean,
    due: string | null,
    dueTime: string | null,
    reminderMinutes: number[],
    startDate: string | null,
  ) => {
    const placed = (tasks ?? []).filter((t) => !t.staged)
    const { x, y } = placeInQuadrant(dest, placed)
    addTask.mutate(
      {
        text,
        x,
        y,
        staged: false,
        recurring,
        ongoing,
        due,
        due_time: dueTime,
        start_date: startDate,
      },
      {
        onSuccess: (created) => {
          if (dueTime) {
            for (const m of reminderMinutes) reminderWrites.add(created.id, m)
          }
        },
      },
    )
    onAdded?.(dest)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add a task">
      <AddTaskForm
        defaultQuadrant={defaultQuadrant}
        onAdd={handleAdd}
        reminderDefault={reminderDefault}
        inputRef={inputRef}
        onOpenChat={
          onOpenChat
            ? () => {
                onClose()
                onOpenChat()
              }
            : undefined
        }
      />
    </BottomSheet>
  )
}
