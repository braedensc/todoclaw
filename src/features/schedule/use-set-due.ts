import type { Task } from '../../types/task'
import { pauseClearsDue } from '../../lib/start-date'
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
    // (The ONE exemption is useSetStartDate's pause-clear below — see its comment for why.)
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

// The SchedulePanel PAUSE write, shared by every surface with a Pause control (grid card ⋯ menu,
// cluster rows, touch grid takeover, list rows). Pausing a NON-recurring task past its due date
// also clears `due` + `due_time` in the SAME patch (pauseClearsDue) — otherwise the task wakes
// already weeks overdue, which is never what "shelve this until then" meant. The DB trigger drops
// the orphaned reminder rows when due goes null, so the cleared-due write is exempt from
// useSetDueWithDefaultReminder above (#305): it can never seed a reminder (clearing, not gaining
// a time) and never touches a recurring chore (pauseClearsDue skips them), so neither of that
// hook's two jobs applies. One atomic patch, not two mutations — two would race the optimistic
// cache and _clientRev. (The reminder rows the DB trigger drops with the due date are refetched
// by useUpdateTask itself, which invalidates task_reminders on any due-clearing patch.)
export function useSetStartDate() {
  const updateTask = useUpdateTask()

  return (task: Pick<Task, 'id' | 'due' | 'recurring'>, startDate: string | null) => {
    const patch: Parameters<typeof updateTask.mutate>[0]['patch'] = pauseClearsDue(task, startDate)
      ? { start_date: startDate, due: null, due_time: null }
      : { start_date: startDate }
    updateTask.mutate({ id: task.id, patch })
  }
}
