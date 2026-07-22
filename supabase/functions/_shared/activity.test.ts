// Deno tests for the shared activity vocabulary (normalizeActivity / describeActivity / activityTally).
// Run: deno test --no-check supabase/functions/_shared/activity.test.ts
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { activityTally, describeActivity, normalizeActivity, type ActivityRow } from './activity.ts'

Deno.test('normalizeActivity: typed rows through, malformed dropped, detail coerced', () => {
  const rows = normalizeActivity([
    { kind: 'completed', task_text: 'Pay rent', detail: { type: 'oneoff' } },
    { kind: 'moved', task_text: 'Deck' }, // no detail → {}
    { task_text: 'no kind' }, // dropped (no kind)
    { kind: 'created', task_text: 42 }, // task_text not string → ''
    'nope', // dropped
    null, // dropped
    { kind: 'renamed', task_text: 'X', detail: [1, 2] }, // detail array → {}
  ])
  assertEquals(rows.length, 4)
  assertEquals(rows[0], { kind: 'completed', taskText: 'Pay rent', detail: { type: 'oneoff' } })
  assertEquals(rows[1].detail, {})
  assertEquals(rows[2], { kind: 'created', taskText: '', detail: {} })
  assertEquals(rows[3].detail, {})
})

Deno.test('normalizeActivity: a non-array is empty', () => {
  assertEquals(normalizeActivity(null), [])
  assertEquals(normalizeActivity({ kind: 'x' }), [])
  assertEquals(normalizeActivity('x'), [])
})

Deno.test('describeActivity: each kind renders a clear past-tense line', () => {
  const d = (kind: string, detail: Record<string, unknown> = {}, taskText = 'Taxes') =>
    describeActivity({ kind, taskText, detail })
  assertEquals(d('created'), 'created "Taxes"')
  assertEquals(d('created', { ongoing: true }), 'created "Taxes" as an ongoing project')
  assertEquals(d('created', { recurring_days: 3 }), 'created "Taxes" (repeats every 3d)')
  assertEquals(d('completed'), 'finished "Taxes"')
  assertEquals(d('completed', { type: 'recurring' }), 'checked off "Taxes" (recurring)')
  assertEquals(d('deleted'), 'deleted "Taxes"')
  assertEquals(d('renamed', { from: 'Old' }), 'renamed "Old" to "Taxes"')
  assertEquals(d('due_set', { due: '2026-07-25' }), 'set "Taxes" due 2026-07-25')
  assertEquals(
    d('due_set', { due: '2026-07-25', due_time: '16:30:00' }),
    'set "Taxes" due 2026-07-25 at 4:30 PM',
  )
  assertEquals(d('due_cleared'), 'cleared the due date on "Taxes"')
  assertEquals(d('made_recurring', { frequency_days: 7 }), 'made "Taxes" repeat every 7d')
  assertEquals(
    d('recurring_retuned', { frequency_days: 14 }),
    'changed "Taxes" to repeat every 14d',
  )
  assertEquals(d('made_ongoing'), 'made "Taxes" an ongoing project')
  assertEquals(d('type_cleared'), 'made "Taxes" a one-off task again')
  assertEquals(d('paused', { until: '2026-08-01' }), 'paused "Taxes" until 2026-08-01')
  assertEquals(d('resumed'), 'un-paused "Taxes"')
  assertEquals(d('placed', { quadrant: 'Do Now' }), 'placed "Taxes" in Do Now')
  assertEquals(
    d('moved', { from_quadrant: 'Someday', to_quadrant: 'Do Now' }),
    'moved "Taxes" from Someday to Do Now',
  )
})

Deno.test('describeActivity: unknown kind and missing title degrade, never throw', () => {
  assertEquals(describeActivity({ kind: 'weird', taskText: '', detail: {} }), 'updated a task')
})

Deno.test('activityTally: counts by bucket, most-frequent first, top 4, empty → null', () => {
  const rows: ActivityRow[] = [
    { kind: 'completed', taskText: 'a', detail: {} },
    { kind: 'completed', taskText: 'b', detail: {} },
    { kind: 'completed', taskText: 'c', detail: {} },
    { kind: 'created', taskText: 'd', detail: {} },
    { kind: 'moved', taskText: 'e', detail: {} },
    { kind: 'made_ongoing', taskText: 'f', detail: {} }, // → "reorganized"
  ]
  const t = activityTally(rows)!
  assertStringIncludes(t, '3 done')
  assertStringIncludes(t, '1 created')
  assertStringIncludes(t, '1 reorganized')
  // most-frequent first
  assertEquals(t.startsWith('3 done'), true)
  assertEquals(activityTally([]), null)
  assertEquals(activityTally([{ kind: 'nonsense', taskText: 'x', detail: {} }]), null)
})
