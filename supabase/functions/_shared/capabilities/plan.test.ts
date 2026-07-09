// Tests for the plan capabilities: dismiss_plan (clears today's plan via save_daily_plan(date,null))
// and planSummary (the defensive daily_state.plan → PromptPlan extraction that feeds the context).
// Run: deno test --no-check supabase/functions/_shared/capabilities/plan.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { executeTool } from '../chat-tools.ts'
import type { ToolContext } from '../chat-tools.ts'
import { planSummary } from '../chat-context.ts'

// A fake client that records rpc(name, args); dismiss_plan only ever calls save_daily_plan.
function makeCtx() {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as ToolContext['client']
  const ctx: ToolContext = {
    client,
    timeZone: 'America/New_York',
    now: new Date('2026-07-04T15:00:00Z'), // local day 2026-07-04
  }
  return { ctx, rpcCalls }
}

// ---- dismiss_plan ----------------------------------------------------------------------------
Deno.test(
  'dismiss_plan clears today’s local-day plan via save_daily_plan(date, null)',
  async () => {
    const { ctx, rpcCalls } = makeCtx()
    const res = await executeTool('dismiss_plan', {}, ctx)
    assert(!res.is_error)
    assertEquals(res.mutated, ['daily_state'])
    assertEquals(rpcCalls.length, 1)
    assertEquals(rpcCalls[0].name, 'save_daily_plan')
    assertEquals(rpcCalls[0].args, { p_date: '2026-07-04', p_plan: null })
  },
)

// ---- planSummary (defensive extraction) ------------------------------------------------------
Deno.test('planSummary pulls headline, big rock (with when/duration), and small rock names', () => {
  const p = planSummary({
    headline: 'Focused morning.',
    availableTime: '6h',
    bigRock: { task: 'Draft the deck', why: 'due tomorrow', duration: '~2h', when: 'this morning' },
    smallRocks: [{ task: 'Reply to Sam' }, { task: 'Book flights' }],
    habitNote: 'stretch',
  })
  assertEquals(p?.headline, 'Focused morning.')
  assertEquals(p?.bigRock, 'Draft the deck (this morning, ~2h)')
  assertEquals(p?.smallRocks, ['Reply to Sam', 'Book flights'])
})

Deno.test('planSummary returns null for a missing/empty plan', () => {
  assertEquals(planSummary(null), null)
  assertEquals(planSummary({}), null)
  assertEquals(planSummary({ smallRocks: [] }), null)
})

Deno.test('planSummary tolerates a partial/malformed plan without throwing', () => {
  const p = planSummary({ bigRock: { task: 'Just this' }, smallRocks: [{}, { task: '' }, 42] })
  assertEquals(p?.headline, null)
  assertEquals(p?.bigRock, 'Just this') // no when/duration → bare task
  assertEquals(p?.smallRocks, []) // the junk entries are dropped
})
