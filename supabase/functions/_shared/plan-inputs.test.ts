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
  'a DORMANT task (future start_date, user zone) never reaches a plan of either kind',
  () => {
    // NOW is Wed Jun 24 (New York). start_date Jun 25 = tomorrow there → dormant; Jun 24 = today →
    // live. Mirrors isDormant (client) and the dispatch RPC's SQL gate.
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
        due: null,
        due_time: null,
        staged: false,
        recurring: null,
        start_date: '2026-06-25',
      },
      // A paused CHORE sits out its pause too, even when its cadence says overdue.
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
  },
)
