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

// ---- the one-off due-date override on a recurring chore ---------------------------------------
// ADR 2026-07-29-recurring-due-override: a due date on a recurring task is a deadline for the
// CURRENT occurrence, and the nearer of (cadence, due) decides. NOW is Wed Jun 24 2026, 08:00 in
// New York, so a lastDoneAt of the same morning means the chore was ticked off "today".

function chore(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chore',
    text: 'Laundry',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    size: null,
    staged: false,
    recurring: { frequencyDays: 7, lastDoneAt: '2026-06-24T11:00:00.000Z', doneCount: 4 },
    ...overrides,
  }
}

Deno.test('a weekly chore done today stays OUT of the plan on cadence alone', () => {
  const req = buildPlanRequest([chore()], [], {}, TZ, NOW)
  assertEquals(req.recurringDue.length, 0)
})

Deno.test('a due date pulls a mid-cycle recurring chore into the plan', () => {
  const req = buildPlanRequest([chore({ due: '2026-06-24' })], [], {}, TZ, NOW)
  assertEquals(req.recurringDue.length, 1)
  assertEquals(req.recurringDue[0].status, 'due today')
  // It rides in recurringDue, never in `tasks` — a chore is still a chore.
  assertEquals(req.tasks.length, 0)
})

Deno.test('a past due date on a recurring chore reads overdue', () => {
  const req = buildPlanRequest([chore({ due: '2026-06-21' })], [], {}, TZ, NOW)
  assertEquals(req.recurringDue[0].status, 'overdue 3d')
})

Deno.test('a far-out due date never pushes an overdue chore off the plan', () => {
  const rows = [
    chore({
      due: '2026-08-30',
      recurring: { frequencyDays: 5, lastDoneAt: '2026-06-17T11:00:00.000Z', doneCount: 1 },
    }),
  ]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(req.recurringDue[0].status, 'overdue 2d')
})

Deno.test('a paused chore sits out its pause even with a live due date', () => {
  const rows = [chore({ due: '2026-06-24', start_date: '2026-07-01' })]
  const req = buildPlanRequest(rows, [], {}, TZ, NOW)
  assertEquals(req.recurringDue.length, 0)
})
