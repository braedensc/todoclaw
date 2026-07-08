// Tests for the pure dispatcher logic (dispatch.ts): local-hour math, quiet-hours suppression, the
// due-kind decision, and the message content (plan-rich morning, plan-based evening check-in, and
// the deterministic fallbacks).
import { assertEquals, assertStringIncludes, assertNotMatch } from 'jsr:@std/assert@1'
import {
  buildMorningFromPlan,
  buildMorningMessage,
  buildRecapMessage,
  dayNameInTZ,
  dueKind,
  isQuietHour,
  localHourInTZ,
  type DispatchInputs,
  type DispatchPlan,
  type NotificationPrefs,
} from './dispatch.ts'

const noon_utc = new Date('2026-07-07T12:00:00Z')

Deno.test('localHourInTZ: same instant, different zones (DST-aware via Intl)', () => {
  assertEquals(localHourInTZ('America/New_York', noon_utc), 8) // UTC-4 in July
  assertEquals(localHourInTZ('America/Los_Angeles', noon_utc), 5) // UTC-7
  assertEquals(localHourInTZ('Asia/Tokyo', noon_utc), 21) // UTC+9
  assertEquals(localHourInTZ('UTC', noon_utc), 12)
})

Deno.test('localHourInTZ: midnight normalizes to 0', () => {
  assertEquals(localHourInTZ('UTC', new Date('2026-07-07T00:00:00Z')), 0)
})

Deno.test('isQuietHour: normal window [22,7) is exclusive at both computed ends', () => {
  const p: NotificationPrefs = { quietStartHour: 1, quietEndHour: 6 }
  assertEquals(isQuietHour(p, 0), false)
  assertEquals(isQuietHour(p, 1), true)
  assertEquals(isQuietHour(p, 5), true)
  assertEquals(isQuietHour(p, 6), false) // end exclusive
})

Deno.test('isQuietHour: window wrapping past midnight (22→7)', () => {
  const p: NotificationPrefs = { quietStartHour: 22, quietEndHour: 7 }
  assertEquals(isQuietHour(p, 23), true)
  assertEquals(isQuietHour(p, 3), true)
  assertEquals(isQuietHour(p, 7), false) // end exclusive
  assertEquals(isQuietHour(p, 12), false)
})

Deno.test('isQuietHour: unset or degenerate window is never quiet', () => {
  assertEquals(isQuietHour({}, 3), false)
  assertEquals(isQuietHour({ quietStartHour: 5, quietEndHour: 5 }, 5), false)
})

Deno.test('dueKind: matches morning/evening hours only when enabled', () => {
  const p: NotificationPrefs = { enabled: true, morningHour: 8, eveningHour: 21 }
  assertEquals(dueKind(p, 8), 'plan')
  assertEquals(dueKind(p, 21), 'recap')
  assertEquals(dueKind(p, 9), null)
  assertEquals(dueKind({ ...p, enabled: false }, 8), null)
  assertEquals(dueKind({ enabled: true }, 8), null) // no hours configured
})

Deno.test('dueKind: quiet hours suppress even a matching morning hour', () => {
  const p: NotificationPrefs = {
    enabled: true,
    morningHour: 6,
    eveningHour: 21,
    quietStartHour: 0,
    quietEndHour: 7, // 6am falls inside quiet → suppressed
  }
  assertEquals(dueKind(p, 6), null)
  assertEquals(dueKind(p, 21), 'recap') // evening is outside quiet
})

const inputs = (over: Partial<DispatchInputs> = {}): DispatchInputs => ({
  config: { location: 'Atlanta' },
  tasks: [
    { id: 'a', text: 'Alpha', x: 0.8, y: 0.9, due: null, staged: false, recurring: null },
    { id: 'b', text: 'Beta', x: 0.2, y: 0.3, due: null, staged: false, recurring: null },
    { id: 's', text: 'Staged', x: null, y: null, due: null, staged: true, recurring: null },
  ],
  habits: [
    { id: 'h1', text: 'Water', active: true },
    { id: 'h2', text: 'Old', active: false },
  ],
  done: {},
  habit_done: {},
  plan: null,
  ...over,
})

const fullPlan: DispatchPlan = {
  headline: 'Gas stove skills today — nail the trip prep.',
  bigRock: { task: 'Learn to use gas stove + canister', duration: '~1h' },
  smallRocks: [
    { task: 'Book MDI Marathon accommodations', duration: '~20min' },
    { task: 'Grocery run', duration: '~30min' },
  ],
}

Deno.test('dayNameInTZ: weekday in the user zone (date line vs UTC)', () => {
  // 2026-07-08 03:00 UTC is still Tuesday July 7 in New York.
  const t = new Date('2026-07-08T03:00:00Z')
  assertEquals(dayNameInTZ('America/New_York', t), 'Tuesday')
  assertEquals(dayNameInTZ('UTC', t), 'Wednesday')
})

// ---- Morning: plan-rich -------------------------------------------------------------------------

Deno.test(
  'buildMorningFromPlan: full plan → headline + 🪨 + ⚡ + 💪 sections with durations',
  () => {
    const m = buildMorningFromPlan(fullPlan, inputs())
    assertEquals(m.title, 'Good morning! ☀️')
    assertStringIncludes(m.body, 'Gas stove skills today')
    assertStringIncludes(m.body, '🪨 BIG ROCK\n• Learn to use gas stove + canister (~1h)')
    assertStringIncludes(
      m.body,
      '⚡ QUICK WINS\n• Book MDI Marathon accommodations (~20min)\n• Grocery run (~30min)',
    )
    assertStringIncludes(m.body, '💪 HABITS\n• Water') // active only; Old is inactive
    assertStringIncludes(m.body, '— BabyClaw 🐾')
  },
)

Deno.test('buildMorningFromPlan: greeting uses the configured name', () => {
  const m = buildMorningFromPlan(
    fullPlan,
    inputs({ config: { notifications: { name: 'Braeden' } } }),
  )
  assertEquals(m.title, 'Good morning Braeden! ☀️')
})

Deno.test('buildMorningFromPlan: sparse plan renders light — no manufactured sections', () => {
  // No big rock, no quick wins: an open day. The body must NOT contain 🪨/⚡ headers.
  const m = buildMorningFromPlan(
    { headline: 'Light day — nothing due for weeks. Enjoy it.', bigRock: null, smallRocks: [] },
    inputs(),
  )
  assertStringIncludes(m.body, 'Light day')
  assertNotMatch(m.body, /🪨|⚡/)
  assertStringIncludes(m.body, 'open day') // the explicit open-day line
  assertStringIncludes(m.body, '💪 HABITS') // habits still shown — they're daily, not filler
})

Deno.test('buildMorningFromPlan: done habits drop out of the 💪 section', () => {
  const m = buildMorningFromPlan(fullPlan, inputs({ habit_done: { h1: true } }))
  assertNotMatch(m.body, /💪/) // Water done, Old inactive → no habits section at all
})

Deno.test('buildMorningFromPlan: malformed rocks (opaque jsonb) degrade, never throw', () => {
  const m = buildMorningFromPlan(
    { headline: 'Hm.', bigRock: {}, smallRocks: [{ duration: '~5min' }, { task: 'Real one' }] },
    inputs(),
  )
  assertNotMatch(m.body, /🪨/) // big rock had no task text → section omitted
  assertStringIncludes(m.body, '⚡ QUICK WINS\n• Real one') // taskless small rock dropped
})

// ---- Morning: deterministic fallback -------------------------------------------------------------

Deno.test(
  'buildMorningMessage: counts placed, open, active — excludes staged/done/inactive',
  () => {
    const m = buildMorningMessage(inputs())
    assertEquals(m.title, 'Good morning! ☀️')
    assertStringIncludes(m.body, '2 tasks and 1 habit on deck') // Alpha+Beta (not Staged), Water only
  },
)

Deno.test('buildMorningMessage: everything done/none placed → clear slate', () => {
  const m = buildMorningMessage(inputs({ done: { a: true, b: true }, habits: [] }))
  assertStringIncludes(m.body, 'a clear slate today')
})

// ---- Evening: plan-based check-in ----------------------------------------------------------------

const planWithTasks: DispatchPlan = {
  headline: 'x',
  bigRock: { task: 'Alpha', duration: '~1h' },
  smallRocks: [{ task: 'Beta', duration: '~20min' }, { task: 'Gamma (not on board)' }],
}

Deno.test('buildRecapMessage: numbers the still-unfinished plan items and asks', () => {
  const m = buildRecapMessage(inputs({ plan: planWithTasks }), 'Wednesday')
  assertEquals(m.title, 'Wrapping up Wednesday 👋')
  assertStringIncludes(m.body, 'Which of these did you knock out today?')
  assertStringIncludes(m.body, '1. Alpha\n2. Beta\n3. Gamma (not on board)')
  assertStringIncludes(m.body, 'rest day')
})

Deno.test('buildRecapMessage: done items drop off the list (matched by task text)', () => {
  const m = buildRecapMessage(inputs({ plan: planWithTasks, done: { a: true } }), 'Wednesday')
  assertNotMatch(m.body, /Alpha/) // done this morning → not asked about
  assertStringIncludes(m.body, '1. Beta\n2. Gamma (not on board)') // unmatched Gamma stays listed
})

Deno.test('buildRecapMessage: whole plan finished → celebrate, no list', () => {
  const m = buildRecapMessage(
    inputs({
      plan: { bigRock: { task: 'Alpha' }, smallRocks: [{ task: 'Beta' }] },
      done: { a: true, b: true },
    }),
    'Friday',
  )
  assertEquals(m.title, 'Wrapping up Friday 🎉')
  assertStringIncludes(m.body, 'cleared the whole plan')
  assertNotMatch(m.body, /1\./)
})

Deno.test('buildRecapMessage: no plan on file → gentle generic check-in with board count', () => {
  const m = buildRecapMessage(inputs(), 'Monday')
  assertEquals(m.title, 'Evening check-in 👋')
  assertStringIncludes(m.body, 'No morning plan on file today')
  assertStringIncludes(m.body, 'are 2 tasks on the board') // Alpha + Beta placed & open
  assertStringIncludes(m.body, 'No pressure either way 🙂')
})

Deno.test('buildRecapMessage: no plan AND empty board → check-in without a task nudge', () => {
  const m = buildRecapMessage(inputs({ tasks: [] }), 'Monday')
  assertNotMatch(m.body, /on the board/)
})

Deno.test('buildRecapMessage: greeting uses the configured name', () => {
  const m = buildRecapMessage(
    inputs({ plan: planWithTasks, config: { notifications: { name: 'Braeden' } } }),
    'Wednesday',
  )
  assertStringIncludes(m.body, 'Hey Braeden! Which of these')
})
