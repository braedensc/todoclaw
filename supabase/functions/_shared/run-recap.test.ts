// Tests for the deterministic evening recap (run-recap.ts). No AI, no randomness — same inputs must
// always yield the same message, so the "works without AI" backbone is provable.
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import { buildRecap, type RecapInputs } from './run-recap.ts'

const T = (id: string, text: string) => ({ id, text })

Deno.test('recap: empty board → gentle "nothing today", 0 completed', () => {
  const r = buildRecap({ tasks: [], habits: [], doneTaskIds: {}, doneHabitIds: {} })
  assertEquals(r.completedCount, 0)
  assertStringIncludes(r.body, 'Nothing on the board today')
})

Deno.test('recap: open tasks, none done → encouraging, counts what is waiting', () => {
  const inputs: RecapInputs = {
    tasks: [T('a', 'Alpha'), T('b', 'Beta')],
    habits: [],
    doneTaskIds: {},
    doneHabitIds: {},
  }
  const r = buildRecap(inputs)
  assertEquals(r.completedCount, 0)
  assertStringIncludes(r.body, 'No tasks marked done today')
  assertStringIncludes(r.body, '2 tasks are ready')
})

Deno.test('recap: one done, one open → singular grammar + open count', () => {
  const inputs: RecapInputs = {
    tasks: [T('a', 'Alpha'), T('b', 'Beta')],
    habits: [],
    doneTaskIds: { a: true },
    doneHabitIds: {},
  }
  const r = buildRecap(inputs)
  assertEquals(r.completedCount, 1)
  assertStringIncludes(r.body, 'You finished 1 task: Alpha.')
  assertStringIncludes(r.body, '1 task still open for tomorrow.')
})

Deno.test('recap: everything done → "clears your list", no open line', () => {
  const inputs: RecapInputs = {
    tasks: [T('a', 'Alpha'), T('b', 'Beta')],
    habits: [],
    doneTaskIds: { a: true, b: true },
    doneHabitIds: {},
  }
  const r = buildRecap(inputs)
  assertEquals(r.completedCount, 2)
  assertStringIncludes(r.body, 'You finished 2 tasks: Alpha, Beta.')
  assertStringIncludes(r.body, 'clears your list')
  assertEquals(r.body.includes('still open'), false)
})

Deno.test('recap: >3 completed → names truncate to "+N more"', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) => T(id, id.toUpperCase()))
  const doneTaskIds = Object.fromEntries(tasks.map((t) => [t.id, true]))
  const r = buildRecap({ tasks, habits: [], doneTaskIds, doneHabitIds: {} })
  assertEquals(r.completedCount, 5)
  assertStringIncludes(r.body, 'You finished 5 tasks: A, B, C +2 more.')
})

Deno.test('recap: habits count and are named alongside tasks', () => {
  const inputs: RecapInputs = {
    tasks: [T('a', 'Alpha')],
    habits: [T('h1', 'Water'), T('h2', 'Stretch')],
    doneTaskIds: { a: true },
    doneHabitIds: { h1: true },
  }
  const r = buildRecap(inputs)
  assertEquals(r.completedCount, 2) // 1 task + 1 habit
  assertStringIncludes(r.body, 'You finished 1 task: Alpha.')
  assertStringIncludes(r.body, 'Habits: Water.')
})

Deno.test('recap: blank/whitespace task names are dropped from the inline list', () => {
  const inputs: RecapInputs = {
    tasks: [T('a', '   '), T('b', 'Real task')],
    habits: [],
    doneTaskIds: { a: true, b: true },
    doneHabitIds: {},
  }
  const r = buildRecap(inputs)
  assertEquals(r.completedCount, 2) // still counts both as completed
  assertStringIncludes(r.body, 'Real task')
})
