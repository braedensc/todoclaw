// task-crud.ts — task CRUD through conversation: natural-language creates (plain, dated,
// quadrant words, recurring/ongoing, future start), edits and moves, due-date set/clear
// (clearing wipes reminders), a multi-action turn, and reference resolution — a vague-but-unique
// handle must resolve to the right task; a genuinely ambiguous one must get a question, not a guess.
//
// Chat seeds MUST be now-relative (dayOffsetISO with no base). Dates embedded in turns/checks are
// computed at import time — same run as the seed thunk, so the digits agree (the exemplar pattern
// from lifecycle-intent.ts).

import { dayOffsetISO } from '../../lib/fixture-dates.ts'
import {
  dbTask,
  dbTaskCreated,
  noConfirmRequested,
  noErrorEvents,
  reminderOffsets,
  statusLineAlways,
  toolCalled,
  waitingStatusAt,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario } from '../../lib/types.ts'

const TOMORROW = dayOffsetISO(1)
const CAKE_DAY = dayOffsetISO(3)
const GARDEN_START = dayOffsetISO(6)

/** Reminder offsets for a CREATED task (no seed key — matched by text). */
function createdTaskReminders(match: RegExp, offsets: number[], label: string): ChatCheck {
  return (_t, db) => {
    const row = db.tasks.find((task) => task.deleted_at == null && match.test(task.text))
    if (!row) return { name: label, pass: false, detail: `no created task matches ${match}` }
    const have = db.reminders
      .filter((rem) => rem.task_id === row.id)
      .map((rem) => rem.offset_minutes)
      .sort((a, b) => a - b)
    const want = [...offsets].sort((a, b) => a - b)
    const pass = have.length === want.length && have.every((v, i) => v === want[i])
    return { name: label, pass, ...(pass ? {} : { detail: `actual: [${have.join(', ')}]` }) }
  }
}

/** Exact live-task count — catches "milk and eggs" merged into one create. */
function liveTaskCount(n: number, label: string): ChatCheck {
  return (_t, db) => {
    const live = db.tasks.filter((task) => task.deleted_at == null)
    return {
      name: label,
      pass: live.length === n,
      ...(live.length === n
        ? {}
        : { detail: `live: ${live.map((task) => task.text).join(' | ') || 'none'}` }),
    }
  }
}

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'crud-plain-add-staged',
    title: 'Plain add with no placement signals lands staged',
    tags: ['crud', 'create', 'staged'],
    persona: 'quick capture',
    seed: () => ({}),
    turns: [{ say: 'Add a task to return the library books.' }],
    checks: [
      toolCalled('create_task'),
      dbTaskCreated((row) => /library/i.test(row.text), 'library task created'),
      dbTaskCreated(
        (row) => /library/i.test(row.text) && row.staged,
        'created task is staged (no signals given)',
      ),
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-create-due-default-reminder',
    title: 'Create with due date + time picks up the schedule default reminder automatically',
    tags: ['crud', 'create', 'due-date', 'reminder-default'],
    seed: () => ({
      scheduleConfig: { notifications: { reminderDefaultMinutes: 60 } },
    }),
    turns: [{ say: `Add "pick up the birthday cake" on ${CAKE_DAY} at 4pm.` }],
    checks: [
      dbTaskCreated(
        (row) =>
          /cake/i.test(row.text) &&
          row.due === CAKE_DAY &&
          row.due_time != null &&
          row.due_time.startsWith('16:00'),
        `cake task created due ${CAKE_DAY} 16:00`,
      ),
      createdTaskReminders(/cake/i, [60], 'default 60-min reminder auto-applied'),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-quadrant-words',
    title: 'Urgency/importance words place creates in the right quadrant halves',
    tags: ['crud', 'create', 'quadrant'],
    seed: () => ({}),
    turns: [
      {
        say:
          "Add 'file the insurance claim' — that one is urgent and really important. " +
          "Also add 'reorganize the bookshelf' — not urgent and not important at all.",
      },
    ],
    checks: [
      dbTaskCreated(
        (row) =>
          /insurance/i.test(row.text) &&
          !row.staged &&
          row.x != null &&
          row.x > 0.5 &&
          row.y != null &&
          row.y > 0.5,
        'insurance claim placed in the urgent+important quadrant',
      ),
      dbTaskCreated(
        (row) =>
          /bookshelf/i.test(row.text) &&
          !row.staged &&
          row.x != null &&
          row.x < 0.5 &&
          row.y != null &&
          row.y < 0.5,
        'bookshelf placed in the neither-urgent-nor-important quadrant',
      ),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-create-recurring',
    title: '"Every 5 days" creates a recurring task with frequencyDays 5',
    tags: ['crud', 'create', 'recurring'],
    seed: () => ({}),
    turns: [{ say: 'Add a task to water the ferns every 5 days.' }],
    checks: [
      dbTaskCreated(
        (row) => /fern/i.test(row.text) && row.recurring?.frequencyDays === 5,
        'recurring fern task, every 5 days',
      ),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-create-ongoing',
    title: '"Ongoing project" sets the ongoing flag',
    tags: ['crud', 'create', 'ongoing'],
    seed: () => ({}),
    turns: [
      {
        say:
          "Add 'learn conversational Spanish' as an ongoing project — " +
          'no end date, I just chip away at it.',
      },
    ],
    checks: [
      dbTaskCreated(
        (row) => /spanish/i.test(row.text) && row.ongoing,
        'ongoing Spanish project created',
      ),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-create-future-start',
    title: 'Create with an explicit future start date lands dormant until that day',
    tags: ['crud', 'create', 'start-date', 'pause'],
    seed: () => ({}),
    turns: [
      {
        say:
          `Add 'prep the garden beds for fall planting', but I can't start until ` +
          `${GARDEN_START} — keep it out of my way till then.`,
      },
    ],
    checks: [
      dbTaskCreated(
        (row) =>
          /garden bed/i.test(row.text) &&
          row.start_date != null &&
          row.start_date.slice(0, 10) === GARDEN_START,
        `garden task created with start_date ${GARDEN_START}`,
      ),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-edit-text-and-move',
    title: 'Rename a task, then move another across the urgency midline',
    tags: ['crud', 'edit', 'move', 'quadrant'],
    seed: () => ({
      tasks: [
        { key: 'taxes', text: 'File quarterly taxes', x: 0.3, y: 0.4 },
        { key: 'memo', text: 'Draft memo for the board', x: 0.45, y: 0.6 },
      ],
    }),
    turns: [
      { say: "Rename the board memo task to 'Draft investor memo'." },
      { say: 'And make the taxes task more urgent — it keeps creeping up on me.' },
    ],
    checks: [
      toolCalled('edit_task_text'),
      dbTask('memo', (row) => /investor memo/i.test(row.text), 'memo renamed'),
      toolCalled('move_task'),
      dbTask('taxes', (row) => row.x != null && row.x > 0.5, 'taxes crossed into the urgent half'),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-clear-due-wipes-reminders',
    title: 'Clearing a due date also clears the time and wipes reminders',
    tags: ['crud', 'due-date', 'reminders'],
    seed: () => ({
      tasks: [
        {
          key: 'registration',
          text: 'Renew the car registration',
          x: 0.6,
          y: 0.5,
          due: dayOffsetISO(2),
          dueTime: '09:00',
          reminders: [60, 1440],
        },
      ],
    }),
    turns: [
      { say: 'The registration renewal has no deadline anymore — clear its due date entirely.' },
    ],
    checks: [
      toolCalled('set_due_date'),
      dbTask(
        'registration',
        (row) => row.due == null && row.due_time == null,
        'due + time cleared',
      ),
      reminderOffsets('registration', []),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-multi-add',
    title: 'One message, three separate creates',
    tags: ['crud', 'create', 'multi-action'],
    seed: () => ({}),
    turns: [{ say: 'Add milk, eggs, and a dentist call as three separate tasks.' }],
    checks: [
      dbTaskCreated((row) => /milk/i.test(row.text), 'milk task created'),
      dbTaskCreated((row) => /egg/i.test(row.text), 'eggs task created'),
      dbTaskCreated((row) => /dentist/i.test(row.text), 'dentist call task created'),
      liveTaskCount(3, 'exactly three tasks created'),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-vague-ref-resolves',
    title: 'A vague-but-unique reference resolves to the right task',
    tags: ['crud', 'due-date', 'reference-resolution'],
    persona: 'shorthand talker',
    seed: () => ({
      tasks: [
        { key: 'report', text: 'Finish the Q3 sales report', x: 0.55, y: 0.7 },
        { key: 'ferns', text: 'Repot the ferns', x: 0.3, y: 0.3 },
        { key: 'invoice', text: 'Send the Carver invoice', x: 0.6, y: 0.5 },
      ],
    }),
    turns: [{ say: 'Bump that report thing to tomorrow.' }],
    checks: [
      toolCalled('set_due_date'),
      dbTask('report', (row) => row.due === TOMORROW, `report due ${TOMORROW}`),
      dbTask('invoice', (row) => row.due == null, 'invoice untouched'),
      dbTask('ferns', (row) => row.due == null, 'ferns untouched'),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'crud-ambiguous-ref-asks',
    title: 'Two plausible matches: ask which one, never guess',
    tags: ['crud', 'reference-resolution', 'ambiguity', 'clarify'],
    seed: () => ({
      tasks: [
        { key: 'henderson', text: 'Draft report for the Henderson account', x: 0.45, y: 0.6 },
        { key: 'marlowe', text: 'Draft report for the Marlowe account', x: 0.55, y: 0.65 },
      ],
    }),
    turns: [{ say: 'Push the report task to tomorrow.' }],
    checks: [
      waitingStatusAt(0),
      dbTask('henderson', (row) => row.due == null, 'henderson report untouched'),
      dbTask('marlowe', (row) => row.due == null, 'marlowe report untouched'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'Two tasks plausibly match "the report task" (Henderson and Marlowe). The reply must ask ' +
      'which one — ideally naming both — and change NOTHING until answered. Picking one and ' +
      'moving it, or moving both, is a fail.',
  },
]
