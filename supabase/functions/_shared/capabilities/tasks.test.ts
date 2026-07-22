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
  ongoing: false,
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
  assertEquals(getPatch()?.ongoing, false) // types are exclusive — becoming recurring clears ongoing
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
  assertEquals(getPatch()?.ongoing, false) // types are exclusive — becoming recurring clears ongoing
})

// ---- ongoing projects -------------------------------------------------------------------------
// An ongoing project is now a standalone `ongoing` column, fully decoupled from `recurring`. It is
// completed like any one-off (set_task_done archives it) — there is no session tally, check-in
// cadence, target-end, or Finish anymore. make_ongoing just flips the two mutually-exclusive flags.
Deno.test('make_ongoing flags the task ongoing and clears any recurring cadence', async () => {
  const { ctx, getPatch } = makeMutCtx({ text: 'Redesign the site', recurring: null })
  const res = await executeTool('make_ongoing', { task_id: TASK_ID }, ctx)
  assert(!res.is_error)
  assertEquals(res.mutated, ['tasks'])
  // The whole patch is the two-field, mutually-exclusive flip — no cadence/session/target.
  assertEquals(getPatch(), { ongoing: true, recurring: null })
})

Deno.test('make_ongoing on a recurring chore drops the cadence (types are exclusive)', async () => {
  const { ctx, getPatch } = makeMutCtx({
    text: 'Thesis',
    recurring: { frequencyDays: 7, lastDoneAt: '2026-07-01T00:00:00Z', doneCount: 9 },
  })
  const res = await executeTool('make_ongoing', { task_id: TASK_ID }, ctx)
  assert(!res.is_error)
  // Promoting a chore to a project clears recurring in the same write (DB CHECK keeps them exclusive).
  assertEquals(getPatch(), { ongoing: true, recurring: null })
})

Deno.test(
  'complete_task archives an ongoing project via set_task_done (no session logging)',
  async () => {
    // An ongoing project carries recurring: null, so it completes exactly like a one-off:
    // set_task_done archives it to the Done log. There is no "work session" branch anymore.
    const { ctx, rpcCalls, getPatch } = makeMutCtx({
      text: 'Learn Spanish',
      bucket: 'oneoff',
      recurring: null,
      ongoing: true,
    })
    const res = await executeTool('complete_task', { task_id: TASK_ID }, ctx)
    assert(!res.is_error)
    assertEquals(res.mutated, ['daily_state', 'history'])
    assertEquals(getPatch(), undefined) // archived, not advanced — no recurring update
    assertEquals(rpcCalls.length, 1)
    assertEquals(rpcCalls[0].name, 'set_task_done')
    assertEquals(rpcCalls[0].args.p_text, 'Learn Spanish')
    assert(res.content.includes('done for today'))
  },
)

// ---- search_history id exposure + delete_completion ------------------------------------------
Deno.test(
  'search_history exposes each entry id (for delete_completion), hidden from the user',
  async () => {
    const { ctx } = makeCtx({
      history: [{ id: 'h-1', text: 'Dentist', completed_at: '2026-07-01T15:00:00Z' }],
    })
    const res = await executeTool('search_history', {}, ctx)
    assert(!res.is_error)
    assertEquals(res.display, null) // ids never reach the user
    const rows = JSON.parse(res.content) as Row[]
    assertEquals(rows[0].id, 'h-1')
  },
)

// A one-shot history fake: from('history').delete().eq().select().maybeSingle() resolves to `row`.
function makeHistoryCtx(row: { text: string } | null): ToolContext {
  const client = {
    from() {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        delete: () => b,
        eq: () => b,
        select: () => b,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
      }
      return b
    },
  } as unknown as ToolContext['client']
  return { client, timeZone: 'America/New_York', now: new Date('2026-07-04T15:00:00Z') }
}

Deno.test(
  'delete_completion removes a Done-log entry by id and is a history mutation',
  async () => {
    const res = await executeTool(
      'delete_completion',
      { completion_id: TASK_ID },
      makeHistoryCtx({ text: 'Dentist' }),
    )
    assert(!res.is_error)
    assertEquals(res.mutated, ['history'])
    assert(String(res.content).includes('Dentist'))
  },
)

Deno.test('delete_completion reports not-found when no entry matches the id', async () => {
  const res = await executeTool(
    'delete_completion',
    { completion_id: TASK_ID },
    makeHistoryCtx(null),
  )
  assert(res.is_error)
})

// ---- create_task / set_due_date: due_time + the auto default reminder ------------------------
// A write-capturing fake with per-table behavior: tasks insert()/update() stash the payload (a
// plain select on tasks returns the seeded row — set_due_date's pre-read); task_reminders resolves
// the seeded reminder rows (awaited directly); user_schedule.maybeSingle() returns the seeded
// config; rpc() calls are recorded (set_task_reminder = the auto default write).
function makeWriteCtx(
  seed: { task?: Row | null; reminders?: Row[]; config?: unknown; rpcResults?: Row } = {},
) {
  let inserted: Row | undefined
  let updated: Row | undefined
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    from(table: string) {
      let payload: Row | undefined
      let isWrite = false
      // deno-lint-ignore no-explicit-any
      const q: any = {
        insert: (row: Row) => ((payload = row), (isWrite = true), q),
        update: (p: Row) => ((payload = p), (isWrite = true), q),
        select: () => q,
        eq: () => q,
        is: () => q,
        single: () => (
          (inserted = payload),
          Promise.resolve({ data: { id: 'new-id' }, error: null })
        ),
        maybeSingle: () => {
          if (table === 'user_schedule') {
            return Promise.resolve({
              data: seed.config === undefined ? null : { config: seed.config },
              error: null,
            })
          }
          if (isWrite) {
            updated = payload
            return Promise.resolve({ data: { text: 'Task' }, error: null })
          }
          // set_due_date's pre-read of the task row (default: an undated, untimed task).
          return Promise.resolve({
            data: seed.task === undefined ? { text: 'Task', due_time: null } : seed.task,
            error: null,
          })
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: table === 'task_reminders' ? (seed.reminders ?? []) : [],
            error: null,
          }).then(res, rej),
      }
      return q
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      return Promise.resolve({ data: seed.rpcResults?.[name] ?? null, error: null })
    },
  } as unknown as ToolContext['client']
  const ctx: ToolContext = {
    client,
    timeZone: 'America/New_York',
    now: new Date('2026-07-04T15:00:00Z'),
  }
  return { ctx, rpcCalls, getInserted: () => inserted, getUpdated: () => updated }
}

Deno.test(
  'create_task normalizes a due time to HH:MM:SS (lenient on a single-digit hour)',
  async () => {
    const { ctx, getInserted } = makeWriteCtx()
    const res = await executeTool(
      'create_task',
      { text: 'Call dentist', due: '2026-07-06', due_time: '9:30' },
      ctx,
    )
    assert(!res.is_error)
    assertEquals(getInserted()?.due, '2026-07-06')
    assertEquals(getInserted()?.due_time, '09:30:00')
  },
)

Deno.test('create_task rejects a due time with no due date (nothing is written)', async () => {
  const { ctx, getInserted } = makeWriteCtx()
  const res = await executeTool('create_task', { text: 'Floating', due_time: '15:00' }, ctx)
  assert(res.is_error)
  assertEquals(getInserted(), undefined) // errored before the insert
})

Deno.test('create_task rejects a malformed due time', async () => {
  const { ctx, getInserted } = makeWriteCtx()
  const res = await executeTool(
    'create_task',
    { text: 'Bad time', due: '2026-07-06', due_time: '25:99' },
    ctx,
  )
  assert(res.is_error)
  assertEquals(getInserted(), undefined)
})

Deno.test(
  'create_task with a due time auto-applies the default reminder (1h built-in)',
  async () => {
    const { ctx, rpcCalls } = makeWriteCtx() // no user_schedule row → built-in 60
    const res = await executeTool(
      'create_task',
      { text: 'Emissions test', due: '2026-07-06', due_time: '14:00' },
      ctx,
    )
    assert(!res.is_error)
    assertEquals(rpcCalls, [
      { name: 'set_task_reminder', args: { p_task_id: 'new-id', p_offset_minutes: 60 } },
    ])
    assertEquals(res.mutated, ['tasks', 'reminders'])
    assert(String(res.display).includes('1 hour before (your default)'))
    assert(String(res.content).includes('remove_reminder')) // the model is told how to adjust it
  },
)

Deno.test('create_task honors a custom default offset from Settings', async () => {
  const { ctx, rpcCalls } = makeWriteCtx({
    config: { notifications: { reminderDefaultMinutes: 120 } },
  })
  const res = await executeTool(
    'create_task',
    { text: 'Call bank', due: '2026-07-06', due_time: '10:00' },
    ctx,
  )
  assert(!res.is_error)
  assertEquals(rpcCalls[0]?.args.p_offset_minutes, 120)
})

Deno.test(
  'create_task adds NO reminder when the default is Off, or when there is no time',
  async () => {
    const off = makeWriteCtx({ config: { notifications: { reminderDefaultMinutes: null } } })
    const r1 = await executeTool(
      'create_task',
      { text: 'Quiet task', due: '2026-07-06', due_time: '10:00' },
      off.ctx,
    )
    assert(!r1.is_error)
    assertEquals(off.rpcCalls.length, 0)
    assertEquals(r1.mutated, ['tasks'])
    assert(!String(r1.display).includes('Reminder'))

    const untimed = makeWriteCtx()
    const r2 = await executeTool('create_task', { text: 'All-day', due: '2026-07-06' }, untimed.ctx)
    assert(!r2.is_error)
    assertEquals(untimed.rpcCalls.length, 0) // a date without a time can't anchor a reminder
  },
)

Deno.test('set_due_date sets the time, and clearing the date clears the time', async () => {
  const withTime = makeWriteCtx()
  const r1 = await executeTool(
    'set_due_date',
    { task_id: TASK_ID, due: '2026-07-06', due_time: '15:00' },
    withTime.ctx,
  )
  assert(!r1.is_error)
  assertEquals(withTime.getUpdated()?.due, '2026-07-06')
  assertEquals(withTime.getUpdated()?.due_time, '15:00:00')

  const cleared = makeWriteCtx()
  const r2 = await executeTool('set_due_date', { task_id: TASK_ID, due: null }, cleared.ctx)
  assert(!r2.is_error)
  assertEquals(cleared.getUpdated()?.due, null)
  assertEquals(cleared.getUpdated()?.due_time, null) // clearing the date clears the time
})

Deno.test(
  'set_due_date re-derives urgency only: y is never written, clearing moves nothing',
  async () => {
    const dated = makeWriteCtx()
    const r1 = await executeTool('set_due_date', { task_id: TASK_ID, due: '2026-07-06' }, dated.ctx)
    assert(!r1.is_error)
    const patch = dated.getUpdated()!
    assertEquals(typeof patch.x, 'number') // urgency follows the new date…
    assert(!('y' in patch), 'a due date must never rewrite importance')
    assertEquals(patch.staged, false) // …and a staged task joins the board

    const cleared = makeWriteCtx()
    await executeTool('set_due_date', { task_id: TASK_ID, due: null }, cleared.ctx)
    const clearPatch = cleared.getUpdated()!
    assertEquals(Object.keys(clearPatch).sort(), ['due', 'due_time']) // position untouched
  },
)

Deno.test('set_due_date auto-applies the default when the task FIRST gains a time', async () => {
  const { ctx, rpcCalls } = makeWriteCtx({ task: { text: 'Task', due_time: null } })
  const res = await executeTool(
    'set_due_date',
    { task_id: TASK_ID, due: '2026-07-27', due_time: '14:00' },
    ctx,
  )
  assert(!res.is_error)
  assertEquals(rpcCalls, [
    { name: 'set_task_reminder', args: { p_task_id: TASK_ID, p_offset_minutes: 60 } },
  ])
  assertEquals(res.mutated, ['tasks', 'reminders'])
  assert(String(res.display).includes('your default'))
})

Deno.test('set_due_date does NOT re-apply the default to an already-timed task', async () => {
  // The task already had a time: an empty reminder set may mean "deliberately removed" — moving
  // the date (even with a new time) must not sneak the default back in.
  const { ctx, rpcCalls } = makeWriteCtx({ task: { text: 'Task', due_time: '09:00:00' } })
  const res = await executeTool(
    'set_due_date',
    { task_id: TASK_ID, due: '2026-07-27', due_time: '15:00' },
    ctx,
  )
  assert(!res.is_error)
  assertEquals(rpcCalls.length, 0)
  assertEquals(res.mutated, ['tasks'])
})

Deno.test(
  'a default whose fire time already passed is taken back out and never claimed',
  async () => {
    // "Due earlier today" at creation time: the 1-hour default would fire in the PAST, which the
    // sweep can only drop. The row is removed again and the confirmation stays quiet — promising a
    // reminder that cannot arrive is worse than none. (now = 2026-07-04T15:00:00Z; the RPC's
    // materialized fire_at of 14:00Z is an hour gone.)
    const past = makeWriteCtx({ rpcResults: { set_task_reminder: '2026-07-04T14:00:00Z' } })
    const res = await executeTool(
      'create_task',
      { text: 'Pick up prescription', due: '2026-07-04', due_time: '10:00' },
      past.ctx,
    )
    assert(!res.is_error)
    assertEquals(
      past.rpcCalls.map((c) => c.name),
      ['set_task_reminder', 'remove_task_reminder'],
    )
    assertEquals(res.mutated, ['tasks']) // no reminder domain — nothing survives
    assert(
      !String(res.display).includes('Reminder'),
      'must not promise a reminder that cannot fire',
    )

    // Sanity: a FUTURE fire_at keeps the row and the claim.
    const future = makeWriteCtx({ rpcResults: { set_task_reminder: '2026-07-04T22:00:00Z' } })
    const res2 = await executeTool(
      'create_task',
      { text: 'Evening task', due: '2026-07-04', due_time: '20:00' },
      future.ctx,
    )
    assert(String(res2.display).includes('your default'))
    assertEquals(
      future.rpcCalls.map((c) => c.name),
      ['set_task_reminder'],
    )
  },
)

Deno.test('set_due_date clearing the date reports the reminder wipe', async () => {
  // The DB trigger drops every reminder row when the anchor goes away — the tool must surface
  // that (reminders domain + a note), not absorb it silently.
  const { ctx } = makeWriteCtx({
    task: { text: 'Task', due_time: '09:00:00' },
    reminders: [{ task_id: TASK_ID, offset_minutes: 60 }],
  })
  const res = await executeTool('set_due_date', { task_id: TASK_ID, due: null }, ctx)
  assert(!res.is_error)
  assertEquals(res.mutated, ['tasks', 'reminders'])
  assert(String(res.content).includes('reminders were removed'))
})

Deno.test('set_due_date leaves existing reminders alone when a time is gained', async () => {
  const { ctx, rpcCalls } = makeWriteCtx({
    task: { text: 'Task', due_time: null },
    reminders: [{ task_id: TASK_ID, offset_minutes: 30 }],
  })
  const res = await executeTool(
    'set_due_date',
    { task_id: TASK_ID, due: '2026-07-27', due_time: '14:00' },
    ctx,
  )
  assert(!res.is_error)
  assertEquals(rpcCalls.length, 0) // the 30-min reminder the user already has stands
})
