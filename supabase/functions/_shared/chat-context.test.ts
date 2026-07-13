// Deno tests for loadChatContext — the DB fetch that assembles BabyClaw's per-request context.
// Focus: a one-off task's permanent completion marker (tasks.completed_at) is fetched and carried
// onto the rendered task, so BabyClaw's board mirrors the grid/list — a task completed on a PRIOR
// day never leaks into ACTIVE, while a task completed TODAY still shows under DONE TODAY. A fake
// Supabase client honors the chained .is()/.eq() filters so the query shape is exercised too.
// Run: deno test --no-check supabase/functions/_shared/chat-context.test.ts
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { loadChatContext } from './chat-context.ts'
import { buildSystem } from './chat-prompt.ts'

type Row = Record<string, unknown>
type Seed = { user_schedule?: Row[]; tasks?: Row[]; habits?: Row[]; daily_state?: Row[] }

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
    const api = {
      select: () => api,
      is: (col: string, val: unknown) => (filters.push({ op: 'is', col, val }), api),
      eq: (col: string, val: unknown) => (filters.push({ op: 'eq', col, val }), api),
      order: () => Promise.resolve({ data: rows() }),
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
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
