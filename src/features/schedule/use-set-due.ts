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

  return (task: Pick<Task, 'id' | 'due_time'>, due: string | null, dueTime: string | null) => {
    // Decide from the PRE-write state: gaining a first due time, with no reminder rows. A config
    // that hasn't loaded resolves to Off — a user who chose Off must never get a reminder just
    // because the read hadn't landed (same failure direction as the server-side default).
    const gainsFirstTime = dueTime !== null && !task.due_time
    const hasNoReminders = (reminders?.get(task.id) ?? []).length === 0
    const seedMinutes =
      gainsFirstTime && hasNoReminders && schedule !== undefined
        ? effectiveReminderDefault(schedule?.config.notifications?.reminderDefaultMinutes)
        : null

    // The reminder write must FOLLOW the task write: set_task_reminder computes fire_at from the
    // row's stored due date+time and raises while there is none. A failed due write already
    // toasts via useUpdateTask's onError; the seed is simply skipped.
    updateTask
      .mutateAsync({ id: task.id, patch: { due, due_time: dueTime } })
      .then(() => {
        if (seedMinutes !== null) reminderWrites.add(task.id, seedMinutes)
      })
      .catch(() => {})
  }
}
