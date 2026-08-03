import type { Task } from '../../types/task'
import { useUpdateTask } from '../tasks/use-tasks'
import { useTaskReminders, useTaskReminderWrites } from '../reminders/use-task-reminders'
import { effectiveReminderDefault } from '../reminders/reminder-offsets'
import { useUserSchedule } from './use-user-schedule'

// The SchedulePanel due write, shared by every surface that edits an EXISTING task (grid card ⋯
// menu, cluster popup rows, expanded list row — desktop and mobile alike). Beyond the plain
// { due, due_time } patch it closes the last default-reminder gap: when the task FIRST gains a
// due time and holds no reminders, the user's default (Settings → Task reminders; 1 hour unless
// changed or Off) is applied automatically — matching the add forms, which pre-select the picker,
// and BabyClaw's create_task/set_due_date. The zero-rows guard mirrors the server side: an
// already-timed task is left entirely alone, so a deliberately cleared reminder is never re-added
// by a later date or time change.
export function useSetDueWithDefaultReminder() {
  const updateTask = useUpdateTask()
  const { data: schedule } = useUserSchedule()
  const { data: reminders } = useTaskReminders()
  const reminderWrites = useTaskReminderWrites()

  return (
    task: Pick<Task, 'id' | 'due_time' | 'recurring'>,
    due: string | null,
    dueTime: string | null,
  ) => {
    // Decide from the PRE-write state: gaining a first due time, with no reminder rows. A config
    // that hasn't loaded resolves to Off — a user who chose Off must never get a reminder just
    // because the read hadn't landed (same failure direction as the server-side default).
    const gainsFirstTime = dueTime !== null && !task.due_time
    const hasNoReminders = (reminders?.get(task.id) ?? []).length === 0
    const seedMinutes =
      gainsFirstTime && hasNoReminders && schedule !== undefined
        ? effectiveReminderDefault(schedule?.config.notifications?.reminderDefaultMinutes)
        : null

    // On a RECURRING chore, picking a day has to mean "this next happens then" — that is what the
    // user is doing when they open the calendar. `due` alone could never deliver that: on a chore it
    // is only the reminder ANCHOR, which no board or plan reader consults, so the control confirmed
    // a write and changed nothing visible (the laundry bug, 2026-07-29). So the same tap also sets
    // the one-shot occurrence override, and the two land on the SAME day — the chore surfaces then,
    // and its reminder counts from then. Clearing the date clears the override with it.
    //
    // This lives in the shared hook rather than in each panel because EVERY existing-task due write
    // routes through here (#305), so all five schedule surfaces get it at once and none can drift.
    const patch: Parameters<typeof updateTask.mutate>[0]['patch'] = { due, due_time: dueTime }
    if (task.recurring) {
      patch.recurring = { ...task.recurring, nextDueOn: due }
    }

    // The reminder write must FOLLOW the task write: set_task_reminder computes fire_at from the
    // row's stored due date+time and raises while there is none. A failed due write already
    // toasts via useUpdateTask's onError; the seed is simply skipped.
    updateTask
      .mutateAsync({ id: task.id, patch })
      .then(() => {
        if (seedMinutes !== null) reminderWrites.add(task.id, seedMinutes)
      })
      .catch(() => {})
  }
}
