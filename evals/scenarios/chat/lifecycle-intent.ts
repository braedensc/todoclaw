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
    title: 'Keep-but-hide intent: first response should offer pause, not completion',
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
      'The task on the board is "go to the movie" — a fixed-day event whose reminder the user ' +
      'explicitly wants to keep. The ideal first response offers to PAUSE the task (or set its ' +
      'start date) until the movie day, explaining it keeps the task and its reminders while ' +
      'hiding it from plans until then. Proposing to mark it done or delete it is a fail ' +
      '(completing hides the task and stops its reminders — the opposite of the stated intent). ' +
      'Asking a short clarifying question that includes pause as an option is acceptable.',
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
      'By the end of the conversation the movie task must be paused (start date on the movie ' +
      'day or nearby), NOT completed, NOT deleted, reminders intact. Bonus: the assistant ' +
      'explains that pause keeps the reminder.',
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
      'After the decline the assistant must acknowledge without executing anything, without ' +
      'guilt-tripping, and offer a sensible next step (e.g. remind later / split the task).',
  },
]
