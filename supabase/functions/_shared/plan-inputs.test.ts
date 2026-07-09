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
      size: 'XL',
      staged: false,
      recurring: null,
    },
    // No size key at all — the dispatch RPC shape before/skew, or any untagged task.
    { id: 'b', text: 'NoSize', x: 0.8, y: 0.7, due: null, staged: false, recurring: null },
    // A value outside the S/M/L/XL enum must be dropped to null, never leak to the prompt.
    {
      id: 'c',
      text: 'Bad',
      x: 0.8,
      y: 0.7,
      due: null,
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
})
