// Deno tests for loadChatContext — the DB fetch that assembles BabyClaw's per-request context.
// Focus: a one-off task's permanent completion marker (tasks.completed_at) is fetched and carried
// onto the rendered task, so BabyClaw's board mirrors the grid/list — a task completed on a PRIOR
// day never leaks into ACTIVE, while a task completed TODAY still shows under DONE TODAY. A fake
// Supabase client honors the chained .is()/.eq() filters so the query shape is exercised too.
// Run: deno test --no-check supabase/functions/_shared/chat-context.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { loadChatContext, planSummary } from './chat-context.ts'
import { buildSystem } from './chat-prompt.ts'

type Row = Record<string, unknown>
type Seed = {
  user_schedule?: Row[]
  tasks?: Row[]
  habits?: Row[]
  daily_state?: Row[]
  task_activity?: Row[]
}

// A minimal query-builder fake that honors the chained filters loadChatContext uses (.is / .eq).
// A row passes `.is(col, null)` only when the column is null/undefined and `.eq(col, v)` when equal,
// so deleted rows are dropped exactly as .is('deleted_at', null) drops them — while completed rows
// (no longer SQL-filtered) still come back for the render to split.
function fakeClient(seed: Seed): SupabaseClient {
  const tables = seed as Record<string, Row[] | undefined>
  const passes = (row: Row, filters: { op: 'is' | 'eq'; col: string; val: unknown }[]) =>
    filters.every((f) => (f.op === 'is' ? (row[f.col] ?? null) === f.val : row[f.col] === f.val))
  const builder = (table: string) => {
    const filters: { op: 'is' | 'eq'; col: string; val: unknown }[] = []
    const rows = () => (tables[table] ?? []).filter((r) => passes(r, filters))
    // Chainable + thenable: `.order()`/`.limit()` return the builder (so `.order().limit()` works),
    // and awaiting the builder anywhere in the chain resolves the filtered rows (via `.then`).
    const api = {
      select: () => api,
      is: (col: string, val: unknown) => (filters.push({ op: 'is', col, val }), api),
      eq: (col: string, val: unknown) => (filters.push({ op: 'eq', col, val }), api),
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      then: (onF: (v: { data: Row[] }) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows() }).then(onF, onR),
    }
    return api
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

const NOW = new Date('2026-07-04T15:00:00Z') // afternoon in America/New_York
const SCHED = { timezone: 'America/New_York', config: null }
const liveTask = {
  id: 'live',
  text: 'Live errand',
  x: 0.6,
  y: 0.6,
  due: null,
  staged: false,
  recurring: null,
}

Deno.test('loadChatContext: renders the current local time in the TODAY block', async () => {
  // NOW is 15:00 UTC = 11:00 AM in America/New_York — the render must carry that wall-clock next to
  // the date so BabyClaw knows the hour and can read a late-night "tomorrow" the way the user means.
  const { context } = await loadChatContext(fakeClient({ user_schedule: [SCHED] }), NOW)
  assertEquals(context.nowTime, '11:00 AM')
  assertStringIncludes(buildSystem(context), 'July 4, 2026, 11:00 AM (timezone America/New_York).')
})

Deno.test(
  'loadChatContext: a prior-day completed one-off never appears under ACTIVE or DONE TODAY',
  async () => {
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [
        liveTask, // no completed_at, not done today → ACTIVE
        // Completed YESTERDAY: completed_at set, deleted_at null, absent from today's done map.
        {
          id: 'done-oneoff',
          text: 'Finished errand',
          x: 0.7,
          y: 0.7,
          due: null,
          staged: false,
          recurring: null,
          completed_at: '2026-07-03T18:00:00Z',
        },
      ],
      daily_state: [{ date: '2026-07-04', done: {}, habit_done: {}, subtask_done: {} }],
    })

    const { context } = await loadChatContext(client, NOW)

    // The query still returns the completed row (only deleted_at is filtered); completedAt rides along.
    const completed = context.tasks.find((t) => t.id === 'done-oneoff')
    assertEquals(completed?.completedAt, '2026-07-03T18:00:00Z')

    // But the render hides it: a prior-day completion is in neither ACTIVE nor DONE TODAY.
    const system = buildSystem(context)
    const active = system.slice(
      system.indexOf('=== ACTIVE TASKS'),
      system.indexOf('=== DONE TODAY'),
    )
    assertStringIncludes(active, 'Live errand')
    assert(!active.includes('Finished errand'), 'prior-day completion leaked into ACTIVE TASKS')
    assertStringIncludes(system, '=== DONE TODAY ===\nNothing completed yet today.')
  },
)

Deno.test(
  'loadChatContext: a one-off completed TODAY shows under DONE TODAY, never ACTIVE',
  async () => {
    // set_task_done stamps completed_at AND flips today's done map in one transaction — so a task
    // finished today carries both markers. It must land in DONE TODAY (BabyClaw still knows it), and
    // must not appear under ACTIVE. The completed_at filter is deliberately NOT applied in SQL for
    // exactly this reason.
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [
        liveTask,
        {
          id: 'today',
          text: 'Groceries',
          x: 0.5,
          y: 0.5,
          due: null,
          staged: false,
          recurring: null,
          completed_at: '2026-07-04T14:00:00Z',
        },
      ],
      daily_state: [
        { date: '2026-07-04', done: { today: true }, habit_done: {}, subtask_done: {} },
      ],
    })

    const { context } = await loadChatContext(client, NOW)

    const system = buildSystem(context)
    assertStringIncludes(system, '=== DONE TODAY ===\n1 completed today: "Groceries"')
    const active = system.slice(
      system.indexOf('=== ACTIVE TASKS'),
      system.indexOf('=== DONE TODAY'),
    )
    assertStringIncludes(active, 'Live errand')
    assert(!active.includes('Groceries'), "today's completion must not appear under ACTIVE TASKS")
  },
)

Deno.test(
  'loadChatContext: a recurring chore done TODAY reads as DONE TODAY, not ACTIVE (mirrors the board)',
  async () => {
    // A recurring task never enters the daily done map — completing it resets recurring.lastDoneAt.
    // The board hides it for the rest of the local day (recurringDoneToday); BabyClaw's context must
    // match, or it contradicts what the user sees ("you still need to water the plants" after they did).
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [
        // Done today: lastDoneAt is earlier the same local day → out of ACTIVE, into DONE TODAY.
        {
          id: 'water',
          text: 'Water plants',
          x: 0.5,
          y: 0.5,
          due: null,
          staged: false,
          recurring: { frequencyDays: 7, lastDoneAt: '2026-07-04T13:00:00Z', doneCount: 3 },
        },
        // Done last week: still due-ish, stays ACTIVE with its cadence.
        {
          id: 'sweep',
          text: 'Sweep floors',
          x: 0.4,
          y: 0.4,
          due: null,
          staged: false,
          recurring: { frequencyDays: 7, lastDoneAt: '2026-06-30T13:00:00Z', doneCount: 1 },
        },
      ],
      daily_state: [{ date: '2026-07-04', done: {}, habit_done: {}, subtask_done: {} }],
    })

    const { context } = await loadChatContext(client, NOW)
    const system = buildSystem(context)
    const active = system.slice(
      system.indexOf('=== ACTIVE TASKS'),
      system.indexOf('=== DONE TODAY'),
    )

    assert(!active.includes('Water plants'), 'a recurring task done today must leave ACTIVE')
    assertStringIncludes(active, 'Sweep floors') // last week's is still active
    assertStringIncludes(system, '=== DONE TODAY ===\n1 completed today: "Water plants"')
  },
)

Deno.test(
  'loadChatContext: an ongoing project rides off the ongoing column, decoupled from recurring',
  async () => {
    // `ongoing` is its own column now (not a recurring sub-flag). It maps straight onto PromptTask
    // and the board tags the task an "ongoing project", not a recurring cadence.
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [
        {
          id: 'proj',
          text: 'Redesign the site',
          x: 0.4,
          y: 0.9,
          due: null,
          staged: false,
          recurring: null,
          ongoing: true,
        },
      ],
      daily_state: [{ date: '2026-07-04', done: {}, habit_done: {}, subtask_done: {} }],
    })

    const { context } = await loadChatContext(client, NOW)

    const proj = context.tasks.find((t) => t.id === 'proj')
    assertEquals(proj?.ongoing, true)

    const system = buildSystem(context)
    assertStringIncludes(system, 'ongoing project')
  },
)

// BabyClaw's Location line prefers the CONFIRMED place (config.locationResolved, what wttr.in's
// geocoder actually matched) over the raw typed string — so it agrees with the place the plan's
// weather line describes instead of parroting back whatever was typed.
const withConfig = (config: Record<string, unknown>) =>
  fakeClient({
    user_schedule: [{ timezone: 'America/New_York', config }],
    tasks: [],
    daily_state: [{ date: '2026-07-04', done: {}, habit_done: {}, subtask_done: {} }],
  })

Deno.test(
  'loadChatContext: the Location line uses the confirmed place, not the typed string',
  async () => {
    const { context } = await loadChatContext(
      withConfig({
        location: 'Portlnad, OR', // a typo wttr.in silently geocodes to Roberts, Oregon
        locationResolved: 'Roberts, Oregon, United States of America',
      }),
      NOW,
    )
    const system = buildSystem(context)
    // The confirmed place wins: BabyClaw and the weather line now describe the SAME town.
    assertStringIncludes(system, 'Location: Roberts, Oregon, United States of America.')
    assert(!system.includes('Portlnad'), 'the raw typo leaked into the prompt')
  },
)

Deno.test(
  'loadChatContext: the Location line falls back to the typed string when unconfirmed',
  async () => {
    // Every config written before locationResolved existed looks like this. It must keep its
    // Location line — a silent regression here would quietly strip context from existing users.
    const { context } = await loadChatContext(withConfig({ location: 'Atlanta, GA' }), NOW)
    assertStringIncludes(buildSystem(context), 'Location: Atlanta, GA.')
  },
)

Deno.test('loadChatContext: a blank confirmed place does not blank the Location line', async () => {
  const { context } = await loadChatContext(
    withConfig({ location: 'Atlanta, GA', locationResolved: '   ' }),
    NOW,
  )
  assertStringIncludes(buildSystem(context), 'Location: Atlanta, GA.')
})

Deno.test('loadChatContext: no location renders no Location line', async () => {
  const { context } = await loadChatContext(withConfig({ planNotes: 'Mornings only.' }), NOW)
  assert(!buildSystem(context).includes('Location:'), 'rendered a Location line with no location')
})

Deno.test('loadChatContext: the default reminder flows from config into the prompt', async () => {
  // Never set → the built-in 1 hour; an explicit choice → that offset; null → Off. The rendered
  // line is what lets BabyClaw explain reminder behavior from the user's REAL setting.
  const unset = await loadChatContext(withConfig({}), NOW)
  assertEquals(unset.context.reminderDefault, 60)
  assertStringIncludes(buildSystem(unset.context), 'Default reminder: 1 hour before')

  const chosen = await loadChatContext(
    withConfig({ notifications: { reminderDefaultMinutes: 30 } }),
    NOW,
  )
  assertEquals(chosen.context.reminderDefault, 30)
  assertStringIncludes(buildSystem(chosen.context), 'Default reminder: 30 minutes before')

  const off = await loadChatContext(
    withConfig({ notifications: { reminderDefaultMinutes: null } }),
    NOW,
  )
  assertEquals(off.context.reminderDefault, null)
  assertStringIncludes(buildSystem(off.context), 'Default reminder: OFF')
})

// ---- planSummary: done rocks get the ✓ mark ------------------------------------------------------

Deno.test(
  'planSummary: done rocks get ✓ — by taskId first (paraphrase-proof), text fallback',
  () => {
    const tasks = [
      { id: 'a', text: 'Alpha', doneToday: true, completedAt: null },
      { id: 'b', text: 'Beta', doneToday: false, completedAt: null },
      { id: 'c', text: 'Gamma', doneToday: true, completedAt: '2026-07-04T14:00:00Z' },
    ]
    const s = planSummary(
      {
        headline: 'h',
        // The model re-worded the task — only the id can tie them together.
        bigRock: { task: 'Knock out Alpha', duration: '~1h', when: 'morning', taskId: 'a' },
        smallRocks: [
          { task: 'Beta', taskId: 'b' }, // linked, not done → unmarked
          { task: 'Gamma', taskId: 'c' }, // done (id)
          { task: 'Alpha' }, // legacy rock without taskId → exact-text fallback
        ],
      },
      tasks,
    )
    assertEquals(s?.bigRock, '✓ Knock out Alpha (morning, ~1h)')
    assertEquals(s?.smallRocks, ['Beta', '✓ Gamma', '✓ Alpha'])
  },
)

Deno.test('planSummary: text fallback ignores a prior-day completion of a same-named task', () => {
  // completedAt without doneToday = finished on an EARLIER day. Without an id link, that must not
  // strike a same-named plan item (the id path may use it — it is precise).
  const tasks = [{ id: 'x', text: 'Gamma', doneToday: false, completedAt: '2026-07-01T12:00:00Z' }]
  const s = planSummary({ headline: 'h', bigRock: null, smallRocks: [{ task: 'Gamma' }] }, tasks)
  assertEquals(s?.smallRocks, ['Gamma'])
})

Deno.test('planSummary: with no task info the labels render unchanged (back-compat)', () => {
  const s = planSummary({ headline: 'h', bigRock: { task: 'X' }, smallRocks: [{ task: 'Y' }] })
  assertEquals(s?.bigRock, 'X')
  assertEquals(s?.smallRocks, ['Y'])
})

Deno.test(
  "loadChatContext: today's PLAN block marks a completed rock with ✓ (end-to-end wiring)",
  async () => {
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [
        liveTask,
        {
          id: 'today',
          text: 'Groceries',
          x: 0.5,
          y: 0.5,
          due: null,
          staged: false,
          recurring: null,
          completed_at: '2026-07-04T14:00:00Z',
        },
      ],
      daily_state: [
        {
          date: '2026-07-04',
          done: { today: true },
          habit_done: {},
          subtask_done: {},
          plan: {
            headline: 'Focus.',
            bigRock: {
              task: 'Grab the groceries',
              duration: '~30min',
              when: 'morning',
              taskId: 'today',
            },
            smallRocks: [{ task: 'Live errand', taskId: 'live' }],
          },
        },
      ],
    })
    const { context } = await loadChatContext(client, NOW)
    assertEquals(context.plan?.bigRock, '✓ Grab the groceries (morning, ~30min)')
    assertEquals(context.plan?.smallRocks, ['Live errand'])
    const system = buildSystem(context)
    assertStringIncludes(
      system,
      "=== TODAY'S PLAN (already generated; ✓ = that item is already done) ===",
    )
    assertStringIncludes(system, 'Big rock: ✓ Grab the groceries (morning, ~30min).')
  },
)

Deno.test(
  "loadChatContext: today's task_activity renders in the ACTIVITY block; a prior-day row is dropped",
  async () => {
    const client = fakeClient({
      user_schedule: [SCHED],
      tasks: [liveTask],
      daily_state: [{ date: '2026-07-04', done: {}, habit_done: {}, subtask_done: {} }],
      task_activity: [
        // NOW is 2026-07-04T15:00Z = afternoon in America/New_York → local day 2026-07-04.
        {
          kind: 'completed',
          task_text: 'Pay rent',
          detail: {},
          created_at: '2026-07-04T14:00:00Z',
        },
        // 2026-07-03 20:00Z = 16:00 local on the 3rd → a prior local day, must be bucketed out.
        {
          kind: 'created',
          task_text: 'Yesterday thing',
          detail: {},
          created_at: '2026-07-03T20:00:00Z',
        },
      ],
    })
    const { context } = await loadChatContext(client, NOW)
    assertEquals(context.activity.length, 1)
    assertEquals(context.activity[0].taskText, 'Pay rent')
    const sys = buildSystem(context)
    assertStringIncludes(sys, "TODAY'S ACTIVITY")
    assertStringIncludes(sys, 'finished "Pay rent"')
    assert(!sys.includes('Yesterday thing'))
  },
)
