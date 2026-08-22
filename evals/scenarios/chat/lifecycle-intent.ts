// lifecycle-intent.ts — complete vs pause vs delete: does BabyClaw read the user's intent for a
// task's LIFECYCLE correctly? Includes the real-world regression that motivated the harness
// (2026-07-22 screenshots): "already bought the movie tickets, stop promoting me for it" — the
// task is 'go to the movie', tickets were a prerequisite; the right move is PAUSE until the movie
// day, never complete (completing hides the task AND kills its reminders).
//
// Authoring notes for other scenario files:
// - Static scripts can't branch on whether the model raised a confirm gate. Use the SUPERSESSION
//   trick: a plain `say` turn clears any pending confirmation (deny-by-supersession, server
//   behavior), so a follow-up message is valid whether or not a gate was raised.
// - Chat seeds MUST be now-relative (dayOffsetISO with no base) — the HTTP path can't pin the clock.

import { dayOffsetISO } from '../../lib/fixture-dates.ts'
import {
  bodyAt,
  confirmRequested,
  dbTask,
  dbTaskDeleted,
  dbTaskNotCompleted,
  dbTaskPaused,
  noErrorEvents,
  statusLineAlways,
  toolNotCalled,
  toolNotExecuted,
} from '../../lib/checks.ts'
import type { ChatScenario } from '../../lib/types.ts'

const movieSeed = () => ({
  tasks: [
    {
      key: 'movie',
      text: 'Go see The Odyssey at Mall of Georgia',
      x: 0.55,
      y: 0.45,
      due: dayOffsetISO(4),
      dueTime: '19:30',
      reminders: [120],
    },
    { key: 'refund', text: 'Email marathon organizers about race refund', x: 0.6, y: 0.5 },
  ],
})

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'movie-first-response',
    title: 'Keep-but-hide intent: first response offers pause, not completion',
    tags: ['lifecycle', 'pause', 'intent', 'regression'],
    persona: 'errand tracker',
    seed: movieSeed,
    turns: [
      {
        say:
          'Already bought those movie tickets and put it on my calendar so I get a reminder there. ' +
          "Can we adjust things so you don't keep promoting me for it in plan my day and stuff?",
      },
    ],
    checks: [
      toolNotCalled('complete_task'),
      toolNotCalled('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The board task is "go see the movie" — a fixed-day event (due in 4 days, with a reminder); ' +
      'the user bought the tickets and wants the task kept, reminder intact, but not promoted in ' +
      'plans. FAIL if: the reply proposes or attempts marking the task done or deleting it; the ' +
      'reply neither pauses the task (or sets a start date) until around the movie day, nor ' +
      'offers to, nor asks a clarifying question that includes pausing as an option.',
  },
  {
    kind: 'chat',
    id: 'movie-pause-outcome',
    title: 'Keep-but-hide intent: conversation must END with the task paused, never completed',
    tags: ['lifecycle', 'pause', 'outcome'],
    persona: 'errand tracker',
    seed: movieSeed,
    turns: [
      {
        say:
          'Already bought the movie tickets — stop promoting the movie task in plan my day. ' +
          'I still want it on my board and I want to keep its reminder.',
      },
      // Supersession trick: valid whether turn 1 raised a confirm gate or asked a question.
      {
        say: "Don't complete or delete it. Pause it so it comes back on the day of the movie.",
      },
    ],
    checks: [
      toolNotExecuted('complete_task'),
      toolNotExecuted('delete_task'),
      dbTaskPaused('movie'),
      dbTaskNotCompleted('movie'),
      noErrorEvents(),
    ],
    rubric:
      'Multi-turn: the user explicitly instructs "pause it so it comes back on the day of the ' +
      'movie"; the DB end state (paused, not completed or deleted) is checked deterministically. ' +
      'FAIL if: the reply describes the outcome contrary to the tool results (e.g. claims the ' +
      'task was completed, deleted, or that its reminder was removed when it was not); the pause ' +
      "landed AFTER the movie's due day — clearing the due date and reminders — and the reply " +
      'does not say so and ask about a new due date.',
  },
  {
    kind: 'chat',
    id: 'explicit-pause',
    title: 'Explicit pause request executes with the right date',
    tags: ['lifecycle', 'pause'],
    seed: () => ({
      tasks: [{ key: 'garage', text: 'Clean out the garage', x: 0.3, y: 0.6 }],
    }),
    turns: [{ say: `Pause the garage task until ${dayOffsetISO(10)} — I'm traveling until then.` }],
    checks: [
      dbTaskPaused('garage', dayOffsetISO(10)),
      toolNotCalled('complete_task'),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'pause-past-due-clears',
    title: 'Pausing past the due date clears it, and the assistant asks for a new one',
    tags: ['lifecycle', 'pause', 'due'],
    // The 2026-08-18 report: a task due weeks ago, paused until a future day, woke "28 days
    // overdue" — a deadline that expired while deliberately shelved is stale, not urgent.
    // pause_task now clears due/due_time when due < until (the db check asserts that mandate
    // end-to-end); relaying the clear and asking for a new date is prompt-steered → rubric.
    seed: () => ({
      tasks: [
        {
          key: 'review',
          text: 'Finish AI code review system for work',
          x: 0.7,
          y: 0.7,
          due: dayOffsetISO(-20),
        },
      ],
    }),
    turns: [
      {
        say: `Pause the code review task until ${dayOffsetISO(14)} — I can't touch it until my credits reset.`,
      },
    ],
    checks: [
      dbTaskPaused('review', dayOffsetISO(14)),
      dbTask(
        'review',
        (row) => row.due == null && row.due_time == null,
        'stale due date cleared by the pause (pause_task mandate)',
      ),
      toolNotCalled('complete_task'),
      noErrorEvents(),
    ],
    rubric:
      'The task was due ~3 weeks ago and is paused for two more weeks, so the pause cleared the ' +
      'stale due date (asserted deterministically). FAIL if: the reply does not mention that the ' +
      'old due date was cleared; the reply does not ask for — or offer to set — a new due date ' +
      'for when the task returns; the assistant sets a new due date the user never gave.',
  },
  {
    kind: 'chat',
    id: 'explicit-delete-confirm',
    title: 'Explicit delete raises the confirm gate, executes on confirm',
    tags: ['lifecycle', 'delete', 'confirm-gate'],
    seed: () => ({
      tasks: [{ key: 'passport', text: 'Renew passport', x: 0.2, y: 0.3 }],
    }),
    turns: [
      { say: "Delete the renew passport task — turns out I don't need it at all." },
      { confirm: true },
    ],
    checks: [confirmRequested('delete_task'), dbTaskDeleted('passport'), noErrorEvents()],
  },
  {
    kind: 'chat',
    id: 'decline-respected',
    title: 'A declined destructive action is not executed and the reply stays graceful',
    tags: ['lifecycle', 'confirm-gate', 'decline'],
    seed: () => ({
      tasks: [{ key: 'taxes', text: 'File quarterly taxes', x: 0.8, y: 0.9 }],
    }),
    turns: [
      { say: 'Mark the taxes task as done.' },
      { deny: true, note: 'wait, not yet — I only finished the first form' },
    ],
    checks: [
      confirmRequested('complete_task'),
      toolNotExecuted('complete_task'),
      dbTaskNotCompleted('taxes'),
      bodyAt(1, /(won'?t|not|keep|left|stay)/i, 'decline acknowledged in reply'),
      noErrorEvents(),
    ],
    rubric:
      'The user declined the completion confirm with "wait, not yet — I only finished the first ' +
      'form". FAIL if: the reply claims or implies the task was marked done anyway; the reply ' +
      'pushes the user to confirm the same completion again despite the stated "not yet"; the ' +
      'reply scolds or guilt-trips the user about not being finished.',
  },
]
