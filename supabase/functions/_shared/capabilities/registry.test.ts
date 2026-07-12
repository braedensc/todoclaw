// Tests for the transport-agnostic capability registry, exercised through the Anthropic adapter's
// executeTool (validate → run). DB writes hit a tiny FAKE Supabase client that records calls and
// returns canned rows — so we prove the validation gate, input caps, the mutated-domain reporting
// (which drives live-refresh), destructive classification, a representative habit tool, and the
// injected Plan My Day service, all without a real DB or any Anthropic spend.
//
// Run: deno test --no-check supabase/functions/_shared/capabilities/registry.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { z } from 'npm:zod@4.4.3'
import { CAPABILITIES, capabilityByName } from './registry.ts'
import { TOOL_DEFS, DESTRUCTIVE, executeTool, destructiveSummary } from '../chat-tools.ts'
import type { ToolContext } from '../chat-tools.ts'

const UUID = '123e4567-e89b-42d3-a456-426614174000'

// ---- a minimal chainable fake Supabase client ------------------------------------------------
interface Result {
  data?: unknown
  error?: unknown
}
interface Handlers {
  onSelect?: (table: string) => Result
  onInsert?: (table: string, row: unknown) => Result
  onUpdate?: (table: string, patch: unknown) => Result
  onRpc?: (name: string, args: Record<string, unknown>) => Result
}

class Q {
  private mode: 'select' | 'insert' | 'update' = 'select'
  private patch: unknown
  private row: unknown
  constructor(
    private table: string,
    private h: Handlers,
  ) {}
  select() {
    return this
  }
  insert(row: unknown) {
    this.mode = 'insert'
    this.row = row
    return this
  }
  update(patch: unknown) {
    this.mode = 'update'
    this.patch = patch
    return this
  }
  eq() {
    return this
  }
  is() {
    return this
  }
  order() {
    return this
  }
  private result(): Result {
    if (this.mode === 'insert') {
      return this.h.onInsert?.(this.table, this.row) ?? { data: { id: 'new' }, error: null }
    }
    if (this.mode === 'update') {
      return this.h.onUpdate?.(this.table, this.patch) ?? { data: { text: 'row' }, error: null }
    }
    return this.h.onSelect?.(this.table) ?? { data: [], error: null }
  }
  maybeSingle() {
    return Promise.resolve(this.result())
  }
  single() {
    return Promise.resolve(this.result())
  }
  then<T>(onF: (r: Result) => T) {
    return Promise.resolve(this.result()).then(onF)
  }
}

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
function ctx(h: Handlers = {}, services?: ToolContext['services']): ToolContext {
  const client = {
    from: (table: string) => new Q(table, h),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve(h.onRpc?.(name, args) ?? { data: null, error: null })
    },
  } as unknown as ToolContext['client']
  return { client, timeZone: 'America/New_York', now: new Date('2026-07-04T12:00:00Z'), services }
}

// ---- registry composition --------------------------------------------------------------------
Deno.test('registry exposes the full capability set (and NO set_bucket — buckets skipped)', () => {
  const names = new Set(CAPABILITIES.map((c) => c.name))
  const expected = [
    'list_tasks',
    'search_history',
    'delete_completion',
    'create_task',
    'edit_task_text',
    'move_task',
    'set_due_date',
    'set_reminder',
    'set_recurring_reminder',
    'clear_reminder',
    'remove_reminder',
    'make_recurring',
    'make_ongoing',
    'clear_recurring',
    'restore_task',
    'complete_task',
    'finish_ongoing',
    'delete_task',
    'list_habits',
    'create_habit',
    'rename_habit',
    'set_habit_active',
    'set_habit_done',
    'add_habit_step',
    'rename_habit_step',
    'remove_habit_step',
    'set_habit_step_done',
    'delete_habit',
    'generate_plan',
    'dismiss_plan',
    'set_assistant_preference',
  ]
  for (const n of expected) assert(names.has(n), `missing capability: ${n}`)
  assertEquals(names.size, expected.length)
  assert(!names.has('set_bucket'))
})

Deno.test(
  'exactly complete_task, delete_task, delete_habit, delete_completion, finish_ongoing are destructive',
  () => {
    assertEquals([...DESTRUCTIVE].sort(), [
      'complete_task',
      'delete_completion',
      'delete_habit',
      'delete_task',
      'finish_ongoing',
    ])
    for (const d of DESTRUCTIVE) assert(capabilityByName.has(d))
  },
)

Deno.test('every capability derives a valid object JSON schema (no leaked $schema)', () => {
  for (const t of TOOL_DEFS) {
    const s = t.input_schema as Record<string, unknown>
    assertEquals(s.type, 'object')
    assert(!('$schema' in s), `${t.name} leaked $schema`)
    assert(t.description.length > 0)
  }
})

// ---- validation gate + input caps ------------------------------------------------------------
Deno.test('validation rejects bad input BEFORE any DB call (is_error)', async () => {
  assert((await executeTool('create_task', { text: '' }, ctx())).is_error)
  assert((await executeTool('delete_habit', { habit_id: 'not-a-uuid' }, ctx())).is_error)
  assert((await executeTool('rename_habit_step', { habit_id: UUID, step_id: 's' }, ctx())).is_error)
  assert((await executeTool('does_not_exist', {}, ctx())).is_error)
})

Deno.test('input cap: oversized text is rejected at the validation gate', async () => {
  const huge = 'a'.repeat(2001)
  assert((await executeTool('create_habit', { text: huge }, ctx())).is_error)
})

// ---- a representative habit tool round-trip --------------------------------------------------
Deno.test('create_habit inserts and reports the habits domain mutated', async () => {
  const res = await executeTool(
    'create_habit',
    { text: 'Meditate' },
    ctx({ onInsert: () => ({ data: null, error: null }) }),
  )
  assert(!res.is_error)
  assert(res.content.includes('Meditate'))
  assertEquals(res.mutated, ['habits'])
})

// ---- user-facing display vs model-facing content ---------------------------------------------
Deno.test('create_task keeps the id for the model but not for the user', async () => {
  const res = await executeTool(
    'create_task',
    { text: 'SCP', due: '2026-07-08' },
    ctx({ onInsert: () => ({ data: { id: UUID }, error: null }) }),
  )
  assert(!res.is_error)
  // The model needs the id (to chain a follow-up edit/move); the user must never see it.
  assert(res.content.includes(UUID))
  assert(typeof res.display === 'string' && !res.display!.includes(UUID))
  assert(res.display!.includes('SCP'))
})

Deno.test('create_task can create an ongoing project in one shot', async () => {
  let inserted: Record<string, unknown> | undefined
  const res = await executeTool(
    'create_task',
    { text: 'Renovate the kitchen', ongoing_check_in_days: 3, target_end: '2026-09-01' },
    ctx({
      onInsert: (_t, row) => {
        inserted = row as Record<string, unknown>
        return { data: { id: UUID }, error: null }
      },
    }),
  )
  assert(!res.is_error)
  const rec = inserted?.recurring as {
    frequencyDays: number
    doneCount: number
    ongoing: boolean
    targetEnd: string
  }
  assertEquals(rec.frequencyDays, 3)
  assertEquals(rec.doneCount, 0)
  assertEquals(rec.ongoing, true)
  assertEquals(rec.targetEnd, '2026-09-01')
})

Deno.test('make_ongoing and finish_ongoing round-trip through the adapter', async () => {
  const made = await executeTool(
    'make_ongoing',
    { task_id: UUID, check_in_days: 2 },
    ctx({ onSelect: () => ({ data: { recurring: null }, error: null }) }),
  )
  assert(!made.is_error)
  assertEquals(made.mutated, ['tasks'])

  rpcCalls.length = 0
  const finished = await executeTool(
    'finish_ongoing',
    { task_id: UUID },
    ctx({ onSelect: () => ({ data: { text: 'Big project', bucket: 'oneoff' }, error: null }) }),
  )
  assert(!finished.is_error)
  assertEquals(finished.mutated, ['daily_state', 'history'])
  assert(rpcCalls.some((c) => c.name === 'set_task_done'))
})

Deno.test(
  'set_reminder routes through set_task_reminder and reports the reminders domain',
  async () => {
    rpcCalls.length = 0
    const res = await executeTool(
      'set_reminder',
      { task_id: UUID, minutes_before: 60 },
      ctx({
        onSelect: () => ({
          data: { text: 'Dentist', due: '2026-07-08', due_time: '10:30' },
          error: null,
        }),
      }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['reminders'])
    assert(res.content.includes('1 hour before'))
    assert(res.content.includes('Dentist'))
    const call = rpcCalls.find((c) => c.name === 'set_task_reminder')
    assertEquals(call?.args, { p_task_id: UUID, p_offset_minutes: 60 })
  },
)

Deno.test('set_reminder refuses (no RPC) when the task has no due time', async () => {
  rpcCalls.length = 0
  const res = await executeTool(
    'set_reminder',
    { task_id: UUID, minutes_before: 60 },
    ctx({
      onSelect: () => ({
        data: { text: 'Dentist', due: '2026-07-08', due_time: null },
        error: null,
      }),
    }),
  )
  assert(res.is_error)
  assert(res.content.includes('due date and time'))
  assertEquals(rpcCalls.filter((c) => c.name === 'set_task_reminder').length, 0)
})

Deno.test(
  'set_reminder refuses (no RPC) a recurring task — reminders never fire for repeats',
  async () => {
    rpcCalls.length = 0
    const res = await executeTool(
      'set_reminder',
      { task_id: UUID, minutes_before: 60 },
      ctx({
        onSelect: () => ({
          data: {
            text: 'Water plants',
            due: '2026-07-08',
            due_time: '10:30',
            recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
          },
          error: null,
        }),
      }),
    )
    assert(res.is_error)
    assert(res.content.includes('recurring'))
    assertEquals(rpcCalls.filter((c) => c.name === 'set_task_reminder').length, 0)
  },
)

Deno.test(
  'set_recurring_reminder routes through set_recurring_reminder RPC and reports the reminders domain',
  async () => {
    rpcCalls.length = 0
    const res = await executeTool(
      'set_recurring_reminder',
      { task_id: UUID, time: '12:00' },
      ctx({
        onSelect: () => ({
          data: {
            text: 'Take pill',
            recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
          },
          error: null,
        }),
        onRpc: () => ({ data: '2026-07-04T16:00:00Z', error: null }),
      }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['reminders'])
    assert(res.content.includes('Take pill'))
    assert(res.content.includes('every day'))
    assert(res.content.includes('12:00 PM'))
    const call = rpcCalls.find((c) => c.name === 'set_recurring_reminder')
    assertEquals(call?.args, { p_task_id: UUID, p_time_of_day: '12:00' })
  },
)

Deno.test('set_recurring_reminder refuses (no RPC) a non-recurring task', async () => {
  rpcCalls.length = 0
  const res = await executeTool(
    'set_recurring_reminder',
    { task_id: UUID, time: '12:00' },
    ctx({ onSelect: () => ({ data: { text: 'Buy milk', recurring: null }, error: null }) }),
  )
  assert(res.is_error)
  assert(res.content.includes("isn't a recurring task"))
  assertEquals(rpcCalls.filter((c) => c.name === 'set_recurring_reminder').length, 0)
})

Deno.test(
  'set_recurring_reminder validation: a non-HH:MM time is rejected at the gate',
  async () => {
    const res = await executeTool('set_recurring_reminder', { task_id: UUID, time: 'noon' }, ctx())
    assert(res.is_error)
  },
)

Deno.test('set_reminder warns when the computed fire_at is already well in the past', async () => {
  const res = await executeTool(
    'set_reminder',
    { task_id: UUID, minutes_before: 1440 },
    ctx({
      onSelect: () => ({
        data: { text: 'Dentist', due: '2026-07-04', due_time: '10:30' },
        error: null,
      }),
      // ctx.now is 2026-07-04T12:00:00Z → this fire_at is ~26h earlier → stale.
      onRpc: () => ({ data: '2026-07-03T10:30:00Z', error: null }),
    }),
  )
  assert(!res.is_error)
  assert(res.content.includes("won't fire"))
})

Deno.test('set_reminder not-found short-circuits before any RPC', async () => {
  rpcCalls.length = 0
  const res = await executeTool(
    'set_reminder',
    { task_id: UUID, minutes_before: 0 },
    ctx({ onSelect: () => ({ data: null, error: null }) }),
  )
  assert(res.is_error)
  assert(res.content.includes("couldn't find"))
  assertEquals(rpcCalls.filter((c) => c.name === 'set_task_reminder').length, 0)
})

Deno.test('set_reminder offset 0 confirms "at the due time"', async () => {
  const res = await executeTool(
    'set_reminder',
    { task_id: UUID, minutes_before: 0 },
    ctx({
      onSelect: () => ({
        data: { text: 'Meeting', due: '2026-09-01', due_time: '15:00' },
        error: null,
      }),
      onRpc: () => ({ data: '2026-09-01T19:00:00Z', error: null }), // future → no stale warning
    }),
  )
  assert(!res.is_error)
  assert(res.content.includes('at the due time'))
})

Deno.test(
  'set_reminder validation: minutes_before out of range is rejected at the gate',
  async () => {
    const res = await executeTool('set_reminder', { task_id: UUID, minutes_before: 999999 }, ctx())
    assert(res.is_error)
  },
)

Deno.test('set_reminder accepts the max offset boundary (40320 = 28 days)', async () => {
  const res = await executeTool(
    'set_reminder',
    { task_id: UUID, minutes_before: 40320 },
    ctx({
      onSelect: () => ({
        data: { text: 'Trip', due: '2026-12-01', due_time: '08:00' },
        error: null,
      }),
      onRpc: () => ({ data: '2026-11-03T13:00:00Z', error: null }),
    }),
  )
  assert(!res.is_error)
})

Deno.test(
  'clear_reminder routes through clear_task_reminder and reports the reminders domain',
  async () => {
    rpcCalls.length = 0
    // onSelect returns a row for BOTH the task lookup and the task_reminders existence check.
    const res = await executeTool(
      'clear_reminder',
      { task_id: UUID },
      ctx({ onSelect: () => ({ data: { text: 'Dentist' }, error: null }) }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['reminders'])
    const call = rpcCalls.find((c) => c.name === 'clear_task_reminder')
    assertEquals(call?.args, { p_task_id: UUID })
  },
)

Deno.test('clear_reminder no-ops honestly when the task had no reminder', async () => {
  rpcCalls.length = 0
  const res = await executeTool(
    'clear_reminder',
    { task_id: UUID },
    // The task exists; the task_reminders lookup finds nothing.
    ctx({
      onSelect: (table) =>
        table === 'task_reminders'
          ? { data: null, error: null }
          : { data: { text: 'Dentist' }, error: null },
    }),
  )
  assert(!res.is_error)
  assert(res.content.includes("didn't have a reminder"))
  assertEquals(rpcCalls.filter((c) => c.name === 'clear_task_reminder').length, 0)
})

Deno.test(
  'remove_reminder drops one lead time via remove_task_reminder and reports the reminders domain',
  async () => {
    rpcCalls.length = 0
    // onSelect returns a row for BOTH the task lookup and the (task, offset) existence check.
    const res = await executeTool(
      'remove_reminder',
      { task_id: UUID, minutes_before: 60 },
      ctx({ onSelect: () => ({ data: { text: 'Dentist' }, error: null }) }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['reminders'])
    const call = rpcCalls.find((c) => c.name === 'remove_task_reminder')
    assertEquals(call?.args, { p_task_id: UUID, p_offset_minutes: 60 })
  },
)

Deno.test('remove_reminder no-ops honestly when that lead time was not set', async () => {
  rpcCalls.length = 0
  const res = await executeTool(
    'remove_reminder',
    { task_id: UUID, minutes_before: 60 },
    // The task exists; the (task, offset) lookup finds nothing.
    ctx({
      onSelect: (table) =>
        table === 'task_reminders'
          ? { data: null, error: null }
          : { data: { text: 'Dentist' }, error: null },
    }),
  )
  assert(!res.is_error)
  assert(res.content.includes("didn't have a 1 hour reminder"))
  assertEquals(rpcCalls.filter((c) => c.name === 'remove_task_reminder').length, 0)
})

Deno.test(
  'read-only list tools stream JSON to the model but are hidden from the user',
  async () => {
    for (const name of ['list_tasks', 'list_habits']) {
      const res = await executeTool(
        name,
        {},
        ctx({ onSelect: () => ({ data: [{ id: UUID, text: 'x' }], error: null }) }),
      )
      assert(!res.is_error)
      assert(res.content.includes(UUID)) // model sees the rows
      assertEquals(res.display, null) // user sees nothing (no bubble)
    }
  },
)

Deno.test('a validation failure shows the user a generic line, not the zod dump', async () => {
  const res = await executeTool('create_task', { text: '' }, ctx())
  assert(res.is_error)
  assert(typeof res.display === 'string' && !res.display!.includes('ZodError'))
})

Deno.test('a DB error keeps the raw message for the model but hides it from the user', async () => {
  // A Postgres-style error must never reach the user — the model sees it (to self-correct), the
  // user sees a generic line.
  const raw = 'insert or update on table "tasks" violates foreign key constraint "tasks_user_fk"'
  const res = await executeTool(
    'create_task',
    { text: 'x', due: null },
    ctx({ onInsert: () => ({ data: null, error: { message: raw } }) }),
  )
  assert(res.is_error)
  assert(res.content.includes('foreign key')) // model still gets the detail
  assert(typeof res.display === 'string' && !res.display!.includes('foreign key'))
})

Deno.test('a friendly not-found error is shown verbatim (no generic override)', async () => {
  // Hand-written user-safe messages stay as-is — only raw system text is sanitized.
  const res = await executeTool(
    'edit_task_text',
    { task_id: UUID, text: 'new' },
    ctx({ onUpdate: () => ({ data: null, error: null }) }), // zero rows matched → not found
  )
  assert(res.is_error)
  assertEquals(res.display, undefined) // reuse content
  assert(res.content.includes("couldn't find"))
})

Deno.test('add_habit_step read-modify-writes the subtasks array', async () => {
  let written: { id: string; text: string }[] | undefined
  const res = await executeTool(
    'add_habit_step',
    { habit_id: UUID, text: 'Warm up' },
    ctx({
      onSelect: () => ({ data: { text: 'Stretch', subtasks: [] }, error: null }),
      onUpdate: (_t, patch) => {
        written = (patch as { subtasks: { id: string; text: string }[] }).subtasks
        return { data: { text: 'Stretch' }, error: null }
      },
    }),
  )
  assert(!res.is_error)
  assertEquals(res.mutated, ['habits'])
  assertEquals(written?.length, 1)
  assertEquals(written?.[0]?.text, 'Warm up')
  assert(typeof written?.[0]?.id === 'string' && written[0].id.length > 0)
})

Deno.test(
  'set_habit_done routes through set_daily_flag (habit_done) and touches daily_state',
  async () => {
    rpcCalls.length = 0
    const res = await executeTool(
      'set_habit_done',
      { habit_id: UUID, done: true },
      ctx({ onSelect: () => ({ data: { text: 'Meditate', subtasks: [] }, error: null }) }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['daily_state'])
    const flag = rpcCalls.find((c) => c.name === 'set_daily_flag')
    assertEquals(flag?.args.p_map, 'habit_done')
    assertEquals(flag?.args.p_key, UUID)
    assertEquals(flag?.args.p_value, true)
  },
)

// ---- destructive-confirm surface -------------------------------------------------------------
Deno.test('delete_habit is destructive and its confirm summary names the habit', () => {
  assert(DESTRUCTIVE.has('delete_habit'))
  assertEquals(
    destructiveSummary('delete_habit', { habit_id: 'h1' }, 'Meditate'),
    'Delete the habit "Meditate"',
  )
})

// ---- the injected Plan My Day service --------------------------------------------------------
Deno.test('generate_plan uses the injected service, else degrades gracefully', async () => {
  const withSvc = ctx(
    {},
    { generatePlan: () => Promise.resolve({ ok: true, headline: 'Focus day' }) },
  )
  const ok = await executeTool('generate_plan', {}, withSvc)
  assert(!ok.is_error)
  assert(ok.content.includes('Focus day'))
  assertEquals(ok.mutated, ['daily_state'])

  const noSvc = await executeTool('generate_plan', {}, ctx())
  assert(noSvc.is_error)
})

// ---- a sanity check that toJSONSchema is what the adapter ships -------------------------------
Deno.test('create_task tool schema exposes the text property', () => {
  const def = TOOL_DEFS.find((t) => t.name === 'create_task')!
  const schema = def.input_schema as { properties?: Record<string, unknown>; type?: string }
  assertEquals(schema.type, 'object')
  assert(schema.properties && 'text' in schema.properties)
  // The zod schema is the single source of truth for both validation and this wire schema.
  assert(z.toJSONSchema)
})
