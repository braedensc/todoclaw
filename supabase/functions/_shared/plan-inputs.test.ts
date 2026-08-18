// Deno unit tests for the SERVER-side buildPlanRequest twin (used by run-plan.ts and the proactive
// dispatcher). Mirrors src/features/ai/use-plan-my-day.test.tsx; here we pin the size handling
// specifically, since the dispatch path feeds this from an RPC whose rows may lack a size.
// Run: deno test --no-check supabase/functions/_shared/plan-inputs.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { buildPlanRequest } from './plan-inputs.ts'

const NOW = new Date('2026-06-24T12:00:00.000Z') // Wed Jun 24 2026
const TZ = 'America/New_York'

Deno.test('carries task size through, narrowing a missing or invalid value to null', () => {
  const rows = [
    {
      id: 'a',
      text: 'Sized',
      x: 0.8,
      y: 0.7,
      due: null,
      due_time: null,
      size: 'XL',
      staged: false,
      recurring: null,
    },
    // No size key at all — the dispatch RPC shape before/skew, or any untagged task.
    {
      id: 'b',
      text: 'NoSize',
      x: 0.8,
      y: 0.7,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
    },
    // A value outside the S/M/L/XL enum must be dropped to null, never leak to the prompt.
    {
      id: 'c',
      text: 'Bad',
      x: 0.8,
      y: 0.7,
      due: null,
      due_time: null,
      size: 'HUGE',
      staged: false,
      recurring: null,
    },
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(Object.fromEntries(req.tasks.map((t) => [t.text, t.size])), {
    Sized: 'XL',
    NoSize: null,
    Bad: null,
  })
  // Ids ride along so emitted rocks can be tied back to their tasks (resolvePlanTaskIds).
  assertEquals(
    req.tasks.map((t) => t.id),
    ['a', 'b', 'c'],
  )
})

Deno.test('a due recurring chore carries its task id into recurringDue', () => {
  const rows = [
    {
      id: 'chore',
      text: 'Water plants',
      x: 0.5,
      y: 0.5,
      due: null,
      due_time: null,
      size: null,
      staged: false,
      recurring: { frequencyDays: 3, lastDoneAt: '2026-06-20T12:00:00.000Z', doneCount: 4 },
    },
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(req.recurringDue.length, 1)
  assertEquals(req.recurringDue[0].id, 'chore')
})

Deno.test('an ongoing task row surfaces in the plan tasks carrying its ongoing flag', () => {
  const rows = [
    // An ongoing project is placed (recurring: null), so it IS included in the plan tasks, tagged so
    // the planner can pace it.
    {
      id: 'proj',
      text: 'Write the novel',
      x: 0.4,
      y: 0.9,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
      ongoing: true,
    },
    // A plain task with no flag narrows to ongoing: false.
    {
      id: 'plain',
      text: 'Buy milk',
      x: 0.6,
      y: 0.3,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
    },
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(Object.fromEntries(req.tasks.map((t) => [t.text, t.ongoing])), {
    'Write the novel': true,
    'Buy milk': false,
  })
})

Deno.test('an ongoing project carries its session recency as raw facts', () => {
  // NOW is Wed Jun 24 in New York. worked_days are the user's local days, newest first.
  const rows = [
    {
      id: 'today',
      text: 'Worked today',
      x: 0.4,
      y: 0.9,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
      ongoing: true,
      worked_days: ['2026-06-24', '2026-06-23', '2026-06-22'],
    },
    {
      id: 'gap',
      text: 'Long gap',
      x: 0.4,
      y: 0.9,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
      ongoing: true,
      worked_days: ['2026-06-15'],
    },
    // An ongoing project nobody has logged a session on: no signal, said plainly.
    {
      id: 'fresh',
      text: 'Never worked',
      x: 0.4,
      y: 0.9,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
      ongoing: true,
    },
    // A plain task has no session concept at all — empty phrase, never "worked today".
    {
      id: 'plain',
      text: 'Buy milk',
      x: 0.6,
      y: 0.3,
      due: null,
      due_time: null,
      staged: false,
      recurring: null,
      worked_days: ['2026-06-24'], // stale log left behind by a type switch — must not render
    },
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(Object.fromEntries(req.tasks.map((t) => [t.text, t.worked])), {
    'Worked today': 'worked today, 3 days running',
    'Long gap': 'last worked 9 days ago',
    'Never worked': 'no sessions logged yet',
    'Buy milk': '',
  })
  // workedToday is the structural flag the prompt filters the rock candidates on.
  assertEquals(Object.fromEntries(req.tasks.map((t) => [t.text, t.workedToday])), {
    'Worked today': true,
    'Long gap': false,
    'Never worked': false,
    'Buy milk': false,
  })
  // The project worked today still ships in `tasks` — deriveAnchors reads this list too.
  assertEquals(req.tasks.length, 4)
})

Deno.test(
  'a DORMANT task never becomes a rock, but a within-window one surfaces in `upcoming`',
  () => {
    // NOW is Wed Jun 24 (New York). start_date Jun 25 = tomorrow there → dormant; Jun 24 = today →
    // live. Mirrors isDormant (client) and the dispatch RPC's SQL gate. A dormant task un-pausing
    // within UPCOMING_WINDOW_DAYS (3) is a "coming up" heads-up — kept OUT of tasks/recurringDue.
    const rows = [
      {
        id: 'a',
        text: 'Live',
        x: 0.8,
        y: 0.7,
        due: null,
        due_time: null,
        staged: false,
        recurring: null,
        start_date: '2026-06-24',
      },
      {
        id: 'b',
        text: 'Paused',
        x: 0.8,
        y: 0.7,
        due: '2026-07-01',
        due_time: null,
        staged: false,
        recurring: null,
        start_date: '2026-06-25', // tomorrow → within the 3-day window
      },
      // A paused CHORE sits out its pause too, even when its cadence says overdue. Its start is 7
      // days out → beyond the window, so it does NOT surface in `upcoming` either.
      {
        id: 'c',
        text: 'PausedChore',
        x: 0.5,
        y: 0.5,
        due: null,
        due_time: null,
        staged: false,
        start_date: '2026-07-01',
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      },
    ]
    const req = buildPlanRequest(rows, [], {}, TZ, NOW)
    assertEquals(
      req.tasks.map((t) => t.text),
      ['Live'],
    )
    assertEquals(req.recurringDue, [])
    // Only the within-window dormant task appears in `upcoming`, carrying its start offset + due.
    assertEquals(
      req.upcoming.map((u) => u.text),
      ['Paused'],
    )
    assertEquals(req.upcoming[0], {
      id: 'b',
      text: 'Paused',
      startsInDays: 1,
      startDate: '2026-06-25',
      due: '2026-07-01',
    })
  },
)

// ---- the reminder ANCHOR is not a deadline ----------------------------------------------------
// On a recurring chore `due`/`due_time` are the reminder occurrence anchor: next_recurring_fire_at
// phases the occurrence grid off them and NEVER advances them, so a chore carrying a reminder
// permanently holds a `due` date receding into the past. Server-side plan selection must key on the
// cadence alone — the twin of the client assertions in src/features/ai/use-plan-my-day.test.tsx.
// A change that read the anchor as a deadline shipped past a green CI once (reverted in #348)
// because nothing pinned this.

function anchoredChore(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chore',
    text: 'Laundry',
    x: 0.5,
    y: 0.5,
    due: '2026-06-01', // weeks behind NOW, as any live anchor is
    due_time: '09:00:00',
    size: null,
    staged: false,
    recurring: { frequencyDays: 7, lastDoneAt: '2026-06-24T11:00:00.000Z', doneCount: 9 },
    ...overrides,
  }
}

Deno.test('an anchor date far in the past does not drag a chore into the plan', () => {
  const req = buildPlanRequest([anchoredChore()], [], {}, TZ, NOW)
  assertEquals(req.recurringDue, []) // cadence says 7 days out
  assertEquals(req.tasks, []) // and a chore is never a plannable task
})

Deno.test('a chore due on its cadence reports the cadence status, not the anchor', () => {
  const rows = [
    anchoredChore({
      recurring: { frequencyDays: 7, lastDoneAt: '2026-06-17T11:00:00.000Z', doneCount: 9 },
    }),
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  // Would read "overdue 23d" and climb daily if the anchor leaked in.
  assertEquals(req.recurringDue, [
    { id: 'chore', text: 'Laundry', status: 'due today', daysLeft: 0 },
  ])
})

Deno.test('an anchor date in the FUTURE cannot mute a genuinely overdue chore', () => {
  const rows = [
    anchoredChore({
      due: '2026-12-25',
      recurring: { frequencyDays: 3, lastDoneAt: '2026-06-19T11:00:00.000Z', doneCount: 2 },
    }),
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(req.recurringDue, [
    { id: 'chore', text: 'Laundry', status: 'overdue 2d', daysLeft: -2 },
  ])
})
