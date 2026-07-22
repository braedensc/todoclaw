// reminders-habits.ts — reminders (offsets, prerequisites, the Settings-only default) and habits
// (create/steps/tick/shelve/delete), plus the recurring-chore completion path.
//
// Grounded in the capability registry (_shared/capabilities/tasks.ts, habits.ts):
// - set_reminder{task_id, minutes_before} needs due + due_time; one call per lead time.
// - remove_reminder drops ONE offset; clear_reminder drops them all (due date/time untouched).
// - The app-wide default reminder is notifications.reminderDefaultMinutes — NO chat tool exists;
//   seeding it null in fixtures keeps exact-offset assertions deterministic (chat due-writes
//   auto-seed the default otherwise).
// - complete_task on a recurring chore advances recurring.lastDoneAt/doneCount — never history.
// Chat seeds MUST be now-relative (dayOffsetISO with no base) — the HTTP path can't pin the clock.

import { dayOffsetISO, instantOffsetISO } from '../../lib/fixture-dates.ts'
import {
  bodyAt,
  confirmRequested,
  dbTask,
  dbTaskNotDeleted,
  noConfirmRequested,
  noErrorEvents,
  noVisibleLeak,
  reminderOffsets,
  statusLineAlways,
  toolCalled,
  toolExecutedOk,
  toolNotCalled,
  waitingStatusAt,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario } from '../../lib/types.ts'

// ---------- local custom checks ----------

/** Today's habit_done flag for a seeded habit (dailyHabitDone is keyed by habit id). */
const habitTickedToday =
  (key: string, want: boolean): ChatCheck =>
  (_t, db) => {
    const id = db.ids.habits[key]
    const done = Boolean(id && db.dailyHabitDone[id])
    const pass = done === want
    return {
      name: `habit "${key}" ${want ? 'ticked' : 'NOT ticked'} for today`,
      pass,
      ...(pass ? {} : { detail: `habit_done map: ${JSON.stringify(db.dailyHabitDone)}` }),
    }
  }

/** Recurring completion = cycle advance: fresh lastDoneAt (this run) + incremented doneCount. */
const recurringCycleAdvanced =
  (key: string, minDoneCount: number): ChatCheck =>
  (_t, db) => {
    const row = db.tasks.find((task) => task.id === db.ids.tasks[key])
    const rec = row?.recurring
    const fresh =
      rec?.lastDoneAt != null && Date.now() - new Date(rec.lastDoneAt).getTime() < 6 * 3_600_000
    const pass = fresh && (rec?.doneCount ?? 0) >= minDoneCount
    return {
      name: `recurring "${key}" cycle advanced (fresh lastDoneAt, doneCount ≥ ${minDoneCount})`,
      pass,
      ...(pass ? {} : { detail: `recurring: ${JSON.stringify(rec ?? null)}` }),
    }
  }

/** Recurring chores never land in the Done log. */
const notInHistory =
  (needle: string, label: string): ChatCheck =>
  (_t, db) => {
    const hit = db.historyTexts.find((t) => t.toLowerCase().includes(needle.toLowerCase()))
    return { name: label, pass: !hit, ...(hit ? { detail: `history has: ${hit}` } : {}) }
  }

export const scenarios: ChatScenario[] = [
  // ---------- reminders ----------
  {
    kind: 'chat',
    id: 'rem-set-hour-before',
    title: 'An hour-before reminder lands on the RIGHT task as offset 60',
    tags: ['reminders', 'offsets'],
    persona: 'appointment keeper',
    seed: () => ({
      tasks: [
        {
          key: 'dentist',
          text: 'Dentist checkup with Dr. Marsh',
          x: 0.55,
          y: 0.5,
          due: dayOffsetISO(2),
          dueTime: '14:00',
        },
        {
          key: 'errand',
          text: 'Pick up dry cleaning',
          x: 0.4,
          y: 0.3,
          due: dayOffsetISO(2),
          dueTime: '17:00',
        },
      ],
    }),
    turns: [{ say: 'Remind me an hour before my dentist checkup.' }],
    checks: [
      toolExecutedOk('set_reminder'),
      reminderOffsets('dentist', [60]),
      reminderOffsets('errand', []),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'rem-multi-offset',
    title: 'Day-before AND hour-before = two set_reminder calls → offsets [60, 1440]',
    tags: ['reminders', 'offsets', 'multi'],
    seed: () => ({
      tasks: [
        {
          key: 'visa',
          text: 'Visa appointment at the consulate',
          x: 0.7,
          y: 0.8,
          due: dayOffsetISO(4),
          dueTime: '10:30',
        },
      ],
    }),
    turns: [{ say: 'For the visa appointment, remind me a day before AND an hour before.' }],
    checks: [reminderOffsets('visa', [60, 1440]), statusLineAlways(), noErrorEvents()],
  },
  {
    kind: 'chat',
    id: 'rem-needs-time-first',
    title: 'Reminder on a date-only task: ask for the time first, never invent one',
    tags: ['reminders', 'prerequisite', 'clarify'],
    persona: 'pet owner',
    seed: () => ({
      // Default reminder OFF so the eventual offsets are exactly what the user asked for
      // (set_due_date would otherwise auto-seed the default when the task first gains a time).
      scheduleConfig: { notifications: { reminderDefaultMinutes: null } },
      tasks: [
        {
          key: 'vet',
          text: 'Take Biscuit to the vet',
          x: 0.6,
          y: 0.65,
          due: dayOffsetISO(1),
        },
      ],
    }),
    turns: [
      { say: "Set a reminder two hours before Biscuit's vet appointment." },
      { say: "Oh right, it's at 15:00 — set that time and then the reminder." },
    ],
    checks: [
      waitingStatusAt(0),
      dbTask(
        'vet',
        (row) => row.due != null && (row.due_time ?? '').startsWith('15:00'),
        'vet task got due time 15:00',
      ),
      reminderOffsets('vet', [120]),
      noErrorEvents(),
    ],
    rubric:
      'A reminder needs a due TIME and the vet task has only a date. Turn 1 must not invent a ' +
      'time: the right move is to explain that and ask what time the appointment is. After the ' +
      'user gives 15:00, the time is set and the two-hour reminder lands.',
  },
  {
    kind: 'chat',
    id: 'rem-trim-then-clear',
    title: 'Drop ONE offset via remove_reminder, then clear all — due date and time survive',
    tags: ['reminders', 'remove', 'clear'],
    seed: () => ({
      tasks: [
        {
          key: 'flight',
          text: 'Check in for the Lisbon flight',
          x: 0.75,
          y: 0.7,
          due: dayOffsetISO(3),
          dueTime: '09:00',
          reminders: [60, 1440],
        },
      ],
    }),
    turns: [
      {
        say: 'Drop the day-before reminder on the flight check-in — the hour-before one is enough.',
      },
      {
        say: 'Actually, stop reminding me about it entirely. Keep the task and its due time though.',
      },
    ],
    checks: [
      toolNotCalled('set_reminder'),
      toolCalled('remove_reminder', {
        where: (input) => input.minutes_before === 1440,
        label: 'day-before offset removed via remove_reminder (not a full clear + re-add)',
      }),
      reminderOffsets('flight', []),
      dbTask('flight', (row) => row.due != null && row.due_time != null, 'due date + time kept'),
      dbTaskNotDeleted('flight'),
      noErrorEvents(),
    ],
    rubric:
      'After the first message only the hour-before reminder should remain (the day-before offset ' +
      'removed surgically). After the second, no reminders remain but the task keeps its due date ' +
      'and time — clearing reminders must never be done by wiping the due time.',
  },
  {
    kind: 'chat',
    id: 'rem-default-is-settings',
    title: 'Changing the app-wide default reminder has no tool — explain and point to Settings',
    tags: ['reminders', 'default', 'boundaries'],
    persona: 'settings tinkerer',
    seed: () => ({
      scheduleConfig: { notifications: { reminderDefaultMinutes: 60 } },
      tasks: [
        {
          key: 'checkup',
          text: 'Annual physical',
          x: 0.5,
          y: 0.6,
          due: dayOffsetISO(5),
          dueTime: '11:00',
          reminders: [60],
        },
      ],
    }),
    turns: [
      {
        say:
          'Can you change my default reminder to 30 minutes before instead of an hour? ' +
          'I want that as the default for every new task.',
      },
    ],
    checks: [
      bodyAt(0, /settings/i, 'reply points to Settings'),
      reminderOffsets('checkup', [60]),
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The app-wide default reminder lives in Settings → Notifications and BabyClaw has no tool ' +
      'for it. The reply must say plainly that it cannot change the default itself and point the ' +
      'user at Settings — not pretend a per-task edit is the fix, and not silently rewrite the ' +
      'existing task’s reminder. Offering per-task adjustments as an explicit extra is fine.',
  },

  // ---------- habits ----------
  {
    kind: 'chat',
    id: 'rem-habit-create-steps',
    title: 'Create a habit and add its two steps via add_habit_step',
    tags: ['habits', 'create', 'steps'],
    seed: () => ({ habits: [{ key: 'water', text: 'Drink 2L of water' }] }),
    turns: [
      {
        say:
          'Set up an evening wind-down habit for me with two steps: journal for five minutes, ' +
          'then read a chapter.',
      },
    ],
    checks: [
      toolExecutedOk('create_habit'),
      toolCalled('add_habit_step', {
        where: (input) => /journal/i.test(String(input.text ?? '')),
        label: 'journal step added',
      }),
      toolCalled('add_habit_step', {
        where: (input) => /read/i.test(String(input.text ?? '')),
        label: 'read-a-chapter step added',
      }),
      noVisibleLeak(),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'rem-habit-tick-today',
    title: "Ticking a habit off writes today's habit_done flag — and only for that habit",
    tags: ['habits', 'done-today'],
    seed: () => ({
      habits: [
        { key: 'stretch', text: 'Morning stretch' },
        { key: 'journal', text: 'Daily journal' },
      ],
    }),
    turns: [{ say: 'Just did my morning stretch — tick it off for today.' }],
    checks: [
      habitTickedToday('stretch', true),
      habitTickedToday('journal', false),
      toolNotCalled('complete_task'),
      noConfirmRequested(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'rem-habit-step-done',
    title: 'Ticking one STEP does not mark the whole habit done',
    tags: ['habits', 'steps', 'done-today'],
    seed: () => ({
      habits: [
        {
          key: 'spanish',
          text: 'Practice Spanish',
          subtasks: [
            { id: 'step-vocab', text: 'Vocab drill' },
            { id: 'step-listening', text: 'Listening practice' },
          ],
        },
      ],
    }),
    turns: [
      {
        say:
          "Mark the vocab drill step of my Spanish habit done — haven't gotten to the " +
          'listening practice yet.',
      },
    ],
    checks: [
      toolExecutedOk('set_habit_step_done'),
      toolNotCalled('set_habit_done'),
      habitTickedToday('spanish', false),
      noErrorEvents(),
    ],
    rubric:
      'Only the vocab-drill step is ticked; the habit itself stays unticked because the ' +
      'listening step remains. The reply confirms the step without claiming the whole habit is done.',
  },
  {
    kind: 'chat',
    id: 'rem-habit-shelve',
    title: '"Shelve for now" deactivates the habit (queued) — never deletes it',
    tags: ['habits', 'deactivate', 'intent'],
    persona: 'injured gym-goer',
    seed: () => ({
      habits: [
        { key: 'gym', text: 'Gym session' },
        { key: 'walk', text: 'Evening walk' },
      ],
    }),
    turns: [
      { say: "Shelve the gym habit for now — my knee's acting up. I'll pick it back up later." },
    ],
    checks: [
      toolCalled('set_habit_active', {
        where: (input) => input.active === false,
        label: 'habit deactivated via set_habit_active(false)',
      }),
      toolNotCalled('delete_habit'),
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The user wants the habit kept but out of the daily list — deactivate it (it moves to the ' +
      'Queued group), never delete. The reply should reassure that it can be reactivated anytime.',
  },
  {
    kind: 'chat',
    id: 'rem-habit-delete-confirm',
    title: 'Explicit habit delete raises the confirm gate, executes on confirm',
    tags: ['habits', 'delete', 'confirm-gate'],
    seed: () => ({
      habits: [
        { key: 'floss', text: 'Floss teeth' },
        { key: 'read', text: 'Read 20 pages' },
      ],
    }),
    turns: [
      { say: "Delete the flossing habit entirely — I've stopped tracking it and want it gone." },
      { confirm: true },
    ],
    checks: [confirmRequested('delete_habit'), toolExecutedOk('delete_habit'), noErrorEvents()],
  },

  // ---------- recurring-chore interplay ----------
  {
    kind: 'chat',
    id: 'rem-recurring-cycle-advance',
    title: 'Completing a recurring chore advances its cycle — task stays live, no history entry',
    tags: ['recurring', 'complete', 'confirm-gate'],
    persona: 'plant parent',
    seed: () => ({
      tasks: [
        {
          key: 'plants',
          text: 'Water the plants',
          x: 0.4,
          y: 0.35,
          recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-8), doneCount: 3 },
        },
      ],
    }),
    turns: [{ say: 'I watered the plants just now — check that off.' }, { confirm: true }],
    checks: [
      confirmRequested('complete_task'),
      toolExecutedOk('complete_task'),
      recurringCycleAdvanced('plants', 4),
      dbTask(
        'plants',
        (row) => row.completed_at == null && row.deleted_at == null,
        'chore stays live (not archived)',
      ),
      notInHistory('water the plants', 'recurring completion wrote NO history entry'),
      noErrorEvents(),
    ],
    rubric:
      'The chore is recurring: checking it off advances the weekly cycle rather than archiving ' +
      'the task. A reply that notes it will come back on its cadence is ideal.',
  },
]
