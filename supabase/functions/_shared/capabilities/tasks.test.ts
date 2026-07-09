// Tests for the read-side task capabilities, exercised through the Anthropic adapter's executeTool
// (validate → run) with a fake read client:
//   * list_tasks mirrors the grid — a one-off task completed on a PRIOR day is dropped, a task
//     completed TODAY stays with done=true (still restorable), completed_at never leaks.
//   * search_history reads the permanent Done log, localizes each completion instant, escapes LIKE
//     metacharacters, and stays hidden from the user (display: null).
// Run: deno test --no-check supabase/functions/_shared/capabilities/tasks.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { executeTool } from '../chat-tools.ts'
import type { ToolContext } from '../chat-tools.ts'

type Row = Record<string, unknown>

// A fake client covering the read chains list_tasks + search_history use. Each `from` returns a
// chainable builder that is also awaitable (thenable) — the tasks/history queries are awaited
// directly, while daily_state ends at .maybeSingle(). `.ilike`/`.limit` are captured so tests can
// assert the query shape, and history rows are filtered/sliced to prove the behavior too.
function makeCtx(seed: { tasks?: Row[]; done?: Record<string, boolean>; history?: Row[] }) {
  const captured: { ilike?: { col: string; pattern: string }; limit?: number } = {}
  const client = {
    from(table: string) {
      let ilikeArg: { col: string; pattern: string } | undefined
      let limitN: number | undefined
      const resolve = () => {
        if (table === 'tasks') return { data: seed.tasks ?? [], error: null }
        if (table === 'history') {
          let rows = (seed.history ?? []) as Row[]
          if (ilikeArg) {
            const needle = ilikeArg.pattern
              .replace(/^%|%$/g, '')
              .replace(/\\(.)/g, '$1')
              .toLowerCase()
            rows = rows.filter((r) => String(r.text).toLowerCase().includes(needle))
          }
          if (limitN != null) rows = rows.slice(0, limitN)
          return { data: rows, error: null }
        }
        return { data: [], error: null }
      }
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select: () => builder,
        is: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: (n: number) => {
          limitN = n
          captured.limit = n
          return builder
        },
        ilike: (col: string, pattern: string) => {
          ilikeArg = { col, pattern }
          captured.ilike = { col, pattern }
          return builder
        },
        maybeSingle: () =>
          Promise.resolve(
            table === 'daily_state'
              ? { data: { done: seed.done ?? {} }, error: null }
              : { data: null, error: null },
          ),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(resolve()).then(res, rej),
      }
      return builder
    },
  } as unknown as ToolContext['client']
  const ctx: ToolContext = {
    client,
    timeZone: 'America/New_York',
    now: new Date('2026-07-04T15:00:00Z'), // local day 2026-07-04
  }
  return { ctx, captured }
}

const task = (over: Row): Row => ({
  id: 'x',
  text: 'x',
  x: 0.5,
  y: 0.5,
  due: null,
  due_time: null,
  staged: false,
  recurring: null,
  completed_at: null,
  ...over,
})

// ---- list_tasks ------------------------------------------------------------------------------
Deno.test('list_tasks drops a prior-day completion, keeps today’s with done=true', async () => {
  const { ctx } = makeCtx({
    tasks: [
      task({ id: 'live', text: 'Live errand' }),
      task({ id: 'olddone', text: 'Old errand', completed_at: '2026-07-03T18:00:00Z' }), // prior day
      task({ id: 'todaydone', text: 'Today errand', completed_at: '2026-07-04T14:00:00Z' }),
      task({ id: 'rec', text: 'Water plants', recurring: { frequencyDays: 7 } }), // recurring done today
    ],
    done: { todaydone: true, rec: true },
  })
  const res = await executeTool('list_tasks', {}, ctx)
  assert(!res.is_error)
  assertEquals(res.display, null) // internal read — hidden from the user

  const rows = JSON.parse(res.content) as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  assert(!byId.has('olddone'), 'prior-day completion must be excluded from list_tasks')
  assertEquals(byId.get('live')?.done, false)
  assertEquals(byId.get('todaydone')?.done, true) // completed today → still listed, restorable
  assertEquals(byId.get('rec')?.done, true) // recurring done today (no completed_at) → done via map

  // completed_at never leaks; due_time + done are exposed.
  const live = byId.get('live')!
  assert(!('completed_at' in live), 'completed_at must not appear in the payload')
  assert('due_time' in live && 'done' in live)
})

// ---- search_history --------------------------------------------------------------------------
Deno.test(
  'search_history returns recent completions with a localized when, hidden from the user',
  async () => {
    const { ctx, captured } = makeCtx({
      history: [
        { text: 'Dentist', completed_at: '2026-07-01T15:00:00Z' },
        { text: 'File taxes', completed_at: '2026-06-01T10:00:00Z' },
      ],
    })
    const res = await executeTool('search_history', {}, ctx)
    assert(!res.is_error)
    assertEquals(res.display, null)
    assertEquals(captured.limit, 20) // default limit applied

    const rows = JSON.parse(res.content) as Row[]
    assertEquals(rows.length, 2)
    assertEquals(rows[0].text, 'Dentist')
    assertEquals(rows[0].completedAt, '2026-07-01T15:00:00Z')
    // 15:00Z → 11:00 AM in America/New_York, formatted in the user's zone.
    assert(String(rows[0].when).includes('Jul 1, 2026'))
    assert(String(rows[0].when).includes('AM'))
  },
)

Deno.test('search_history filters by query via an escaped ILIKE', async () => {
  const { ctx, captured } = makeCtx({
    history: [
      { text: 'Dentist appointment', completed_at: '2026-07-01T15:00:00Z' },
      { text: 'Buy milk', completed_at: '2026-06-30T15:00:00Z' },
    ],
  })
  const res = await executeTool('search_history', { query: 'dentist' }, ctx)
  assert(!res.is_error)
  assertEquals(captured.ilike, { col: 'text', pattern: '%dentist%' })
  const rows = JSON.parse(res.content) as Row[]
  assertEquals(
    rows.map((r) => r.text),
    ['Dentist appointment'],
  )
})

Deno.test('search_history escapes LIKE metacharacters in the query', async () => {
  const { ctx, captured } = makeCtx({ history: [] })
  const res = await executeTool('search_history', { query: '50%_off' }, ctx)
  assert(!res.is_error)
  assertEquals(captured.ilike?.pattern, '%50\\%\\_off%')
})

Deno.test('search_history honors a custom limit and rejects one over the cap', async () => {
  const { ctx, captured } = makeCtx({ history: [] })
  const ok = await executeTool('search_history', { limit: 5 }, ctx)
  assert(!ok.is_error)
  assertEquals(captured.limit, 5)

  const tooBig = await executeTool('search_history', { limit: 100 }, ctx) // schema caps at 50
  assert(tooBig.is_error)
})

// ---- complete_task / make_recurring: recurring correctness ------------------------------------
// A mutation fake: the first from().…maybeSingle() returns the seeded task row; an .update(patch)
// captures the patch and its trailing .select('text').maybeSingle() confirms a match; rpc() calls
// are recorded so a test can prove set_task_done was (or was NOT) invoked.
const TASK_ID = '11111111-1111-4111-8111-111111111111'
function makeMutCtx(seedTask: Row | null) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  let updatePatch: Record<string, unknown> | undefined
  const client = {
    from() {
      let isUpdate = false
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Record<string, unknown>) => {
          isUpdate = true
          updatePatch = p
          return b
        },
        eq: () => b,
        is: () => b,
        maybeSingle: () =>
          Promise.resolve(
            isUpdate
              ? { data: { text: (seedTask?.text as string) ?? 'x' }, error: null }
              : { data: seedTask, error: null },
          ),
      }
      return b
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as ToolContext['client']
  const ctx: ToolContext = {
    client,
    timeZone: 'America/New_York',
    now: new Date('2026-07-04T15:00:00Z'),
  }
  return { ctx, rpcCalls, getPatch: () => updatePatch }
}

Deno.test('complete_task advances a recurring task’s cycle, never set_task_done', async () => {
  const { ctx, rpcCalls, getPatch } = makeMutCtx({
    text: 'Laundry',
    bucket: 'oneoff',
    recurring: { frequencyDays: 7, lastDoneAt: '2026-06-01T00:00:00Z', doneCount: 2 },
  })
  const res = await executeTool('complete_task', { task_id: TASK_ID }, ctx)
  assert(!res.is_error)
  assertEquals(res.mutated, ['tasks']) // the recurrence lives on the task row
  assertEquals(rpcCalls.length, 0) // set_task_done would stamp completed_at → never for recurring
  const rec = getPatch()?.recurring as {
    frequencyDays: number
    lastDoneAt: string
    doneCount: number
  }
  assertEquals(rec.frequencyDays, 7)
  assertEquals(rec.doneCount, 3) // advanced
  assertEquals(rec.lastDoneAt, '2026-07-04T15:00:00.000Z') // reset to now
})

Deno.test('complete_task marks a one-off done via set_task_done', async () => {
  const { ctx, rpcCalls, getPatch } = makeMutCtx({
    text: 'Call bank',
    bucket: 'oneoff',
    recurring: null,
  })
  const res = await executeTool('complete_task', { task_id: TASK_ID }, ctx)
  assert(!res.is_error)
  assertEquals(res.mutated, ['daily_state', 'history'])
  assertEquals(getPatch(), undefined) // no recurring update
  assertEquals(rpcCalls.length, 1)
  assertEquals(rpcCalls[0].name, 'set_task_done')
  assertEquals(rpcCalls[0].args.p_text, 'Call bank')
})

Deno.test('make_recurring preserves lastDoneAt/doneCount when retuning cadence', async () => {
  const { ctx, getPatch } = makeMutCtx({
    text: 'Water plants',
    recurring: { frequencyDays: 7, lastDoneAt: '2026-07-01T00:00:00Z', doneCount: 5 },
  })
  const res = await executeTool('make_recurring', { task_id: TASK_ID, frequency_days: 14 }, ctx)
  assert(!res.is_error)
  const rec = getPatch()?.recurring as {
    frequencyDays: number
    lastDoneAt: string
    doneCount: number
  }
  assertEquals(rec.frequencyDays, 14) // retuned
  assertEquals(rec.lastDoneAt, '2026-07-01T00:00:00Z') // preserved
  assertEquals(rec.doneCount, 5) // preserved
})

Deno.test('make_recurring starts a fresh cycle for a non-recurring task', async () => {
  const { ctx, getPatch } = makeMutCtx({ text: 'New chore', recurring: null })
  const res = await executeTool('make_recurring', { task_id: TASK_ID, frequency_days: 7 }, ctx)
  assert(!res.is_error)
  const rec = getPatch()?.recurring as {
    frequencyDays: number
    lastDoneAt: null
    doneCount: number
  }
  assertEquals(rec.frequencyDays, 7)
  assertEquals(rec.lastDoneAt, null)
  assertEquals(rec.doneCount, 0)
})
