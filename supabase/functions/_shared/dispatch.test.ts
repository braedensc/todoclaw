// Tests for the pure dispatcher logic (dispatch.ts): local-hour math, quiet-hours suppression, the
// due-kind decision, and the message content (plan-rich morning, plan-based evening check-in, and
// the deterministic fallbacks).
import { assertEquals, assertStringIncludes, assertNotMatch } from 'jsr:@std/assert@1'
import { dayNameInTZ } from './dates.ts'
import {
  buildMorningFromPlan,
  buildMorningMessage,
  buildRecapMessage,
  dueKind,
  isQuietHour,
  localHourInTZ,
  normalizePlan,
  type DispatchInputs,
  type DispatchPlan,
  type NotificationPrefs,
  type RecapContext,
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

Deno.test('dueKind: fires at the configured hour, only when enabled', () => {
  const p: NotificationPrefs = { enabled: true, morningHour: 8, eveningHour: 21 }
  assertEquals(dueKind(p, 8), 'plan')
  assertEquals(dueKind(p, 21), 'recap')
  assertEquals(dueKind({ ...p, enabled: false }, 8), null)
  assertEquals(dueKind({ enabled: true }, 8), null) // no hours configured
})

Deno.test('dueKind: a dropped tick is recovered within the catch-up window (the bug)', () => {
  // The exact failure this fixes: the cron skipped the user's 8am tick, so the OLD exact-hour match
  // lost the plan for the whole day. Now any tick in [8, 12) still delivers it — once.
  const p: NotificationPrefs = { enabled: true, morningHour: 8, eveningHour: 21 }
  assertEquals(dueKind(p, 9), 'plan') // 1h late
  assertEquals(dueKind(p, 11), 'plan') // 3h late — still inside the 4h window
  assertEquals(dueKind(p, 12), null) // past the window: a plan this late is noise
  assertEquals(dueKind(p, 7), null) // before the hour: not yet due
  // Evening recovers the same way, wrapping past midnight ([21, 1)).
  assertEquals(dueKind(p, 23), 'recap')
  assertEquals(dueKind(p, 0), 'recap')
  assertEquals(dueKind(p, 1), null)
})

Deno.test('dueKind: quiet hours suppress the hours they cover, catch-up delivers after', () => {
  const p: NotificationPrefs = {
    enabled: true,
    morningHour: 6,
    eveningHour: 21,
    quietStartHour: 0,
    quietEndHour: 7, // 6am falls inside quiet → suppressed
  }
  assertEquals(dueKind(p, 6), null) // the configured hour is quiet
  assertEquals(dueKind(p, 7), 'plan') // first non-quiet tick in [6, 10) delivers
  assertEquals(dueKind(p, 21), 'recap') // evening is outside quiet
})

Deno.test('dueKind: morning wins when tightly-spaced windows overlap', () => {
  // morning [9, 13), evening [11, 15): at 11–12 both cover the hour → morning takes precedence.
  const p: NotificationPrefs = { enabled: true, morningHour: 9, eveningHour: 11 }
  assertEquals(dueKind(p, 11), 'plan')
  assertEquals(dueKind(p, 13), 'recap') // past the morning window, still in evening's
})

// The user's local "today" the morning builders key their ⏰ TODAY section off (matches `ctx.now`
// 2026-07-04 in the fixtures). Tasks below are due:null so no times appear unless a test sets them.
const DAY = '2026-07-04'

const inputs = (over: Partial<DispatchInputs> = {}): DispatchInputs => ({
  config: { location: 'Atlanta' },
  tasks: [
    {
      id: 'a',
      text: 'Alpha',
      x: 0.8,
      y: 0.9,
      due: null,
      due_time: null,
      staged: false,
      size: null,
      recurring: null,
    },
    {
      id: 'b',
      text: 'Beta',
      x: 0.2,
      y: 0.3,
      due: null,
      due_time: null,
      staged: false,
      size: null,
      recurring: null,
    },
    {
      id: 's',
      text: 'Staged',
      x: null,
      y: null,
      due: null,
      due_time: null,
      staged: true,
      size: null,
      recurring: null,
    },
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
    const m = buildMorningFromPlan(fullPlan, inputs(), DAY)
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
    DAY,
  )
  assertEquals(m.title, 'Good morning Braeden! ☀️')
})

Deno.test('buildMorningFromPlan: sparse plan renders light — no manufactured sections', () => {
  // No big rock, no quick wins: an open day. The body must NOT contain 🪨/⚡ headers.
  const m = buildMorningFromPlan(
    { headline: 'Light day — nothing due for weeks. Enjoy it.', bigRock: null, smallRocks: [] },
    inputs(),
    DAY,
  )
  assertStringIncludes(m.body, 'Light day')
  assertNotMatch(m.body, /🪨|⚡/)
  assertStringIncludes(m.body, 'open day') // the explicit open-day line
  assertStringIncludes(m.body, '💪 HABITS') // habits still shown — they're daily, not filler
})

Deno.test('buildMorningFromPlan: done habits drop out of the 💪 section', () => {
  const m = buildMorningFromPlan(fullPlan, inputs({ habit_done: { h1: true } }), DAY)
  assertNotMatch(m.body, /💪/) // Water done, Old inactive → no habits section at all
})

Deno.test('buildMorningFromPlan: malformed rocks (opaque jsonb) degrade, never throw', () => {
  const m = buildMorningFromPlan(
    { headline: 'Hm.', bigRock: {}, smallRocks: [{ duration: '~5min' }, { task: 'Real one' }] },
    inputs(),
    DAY,
  )
  assertNotMatch(m.body, /🪨/) // big rock had no task text → section omitted
  assertStringIncludes(m.body, '⚡ QUICK WINS\n• Real one') // taskless small rock dropped
})

Deno.test('buildMorningFromPlan: ⏰ TODAY lists timed tasks due today, earliest first', () => {
  const timed = inputs({
    tasks: [
      // due today at times → shown, sorted; due:null and other-day excluded; done excluded.
      {
        id: 't1',
        text: 'Dentist',
        x: 0.5,
        y: 0.5,
        due: DAY,
        due_time: '10:30:00',
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 't2',
        text: 'Standup',
        x: 0.5,
        y: 0.5,
        due: DAY,
        due_time: '09:00:00',
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 't3',
        text: 'Later day',
        x: 0.5,
        y: 0.5,
        due: '2026-07-05',
        due_time: '08:00:00',
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 't4',
        text: 'No time',
        x: 0.5,
        y: 0.5,
        due: DAY,
        due_time: null,
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 't5',
        text: 'Done one',
        x: 0.5,
        y: 0.5,
        due: DAY,
        due_time: '07:00:00',
        staged: false,
        size: null,
        recurring: null,
      },
    ],
    done: { t5: true },
  })
  const m = buildMorningFromPlan(fullPlan, timed, DAY)
  assertStringIncludes(m.body, '⏰ TODAY\n• 9:00 AM — Standup\n• 10:30 AM — Dentist')
  assertNotMatch(m.body, /Later day|No time|Done one/)
})

Deno.test('buildMorningFromPlan: a timed task today overrides the open-day line', () => {
  const timed = inputs({
    tasks: [
      {
        id: 't1',
        text: 'Meeting',
        x: 0.5,
        y: 0.5,
        due: DAY,
        due_time: '15:00:00',
        staged: false,
        size: null,
        recurring: null,
      },
    ],
  })
  const m = buildMorningFromPlan({ headline: 'Quiet.', bigRock: null, smallRocks: [] }, timed, DAY)
  assertStringIncludes(m.body, '⏰ TODAY\n• 3:00 PM — Meeting')
  assertNotMatch(m.body, /open day/) // an anchor exists → not an "open day"
})

// ---- Morning: deterministic fallback -------------------------------------------------------------

Deno.test(
  'buildMorningMessage: counts placed, open, active — excludes staged/done/inactive',
  () => {
    const m = buildMorningMessage(inputs(), DAY)
    assertEquals(m.title, 'Good morning! ☀️')
    assertStringIncludes(m.body, '2 tasks and 1 habit on deck') // Alpha+Beta (not Staged), Water only
  },
)

Deno.test('buildMorningMessage: everything done/none placed → clear slate', () => {
  const m = buildMorningMessage(inputs({ done: { a: true, b: true }, habits: [] }), DAY)
  assertStringIncludes(m.body, 'a clear slate today')
})

// ---- Evening: plan-based check-in ----------------------------------------------------------------

const planWithTasks: DispatchPlan = {
  headline: 'x',
  bigRock: { task: 'Alpha', duration: '~1h' },
  smallRocks: [{ task: 'Beta', duration: '~20min' }, { task: 'Gamma (not on board)' }],
}

const ctx = (over: Partial<RecapContext> = {}): RecapContext => ({
  dayName: 'Wednesday',
  timeZone: 'UTC',
  localDate: '2026-07-07',
  ...over,
})

Deno.test('buildRecapMessage: numbers the still-unfinished plan items and asks', () => {
  const m = buildRecapMessage(inputs({ plan: planWithTasks }), ctx())
  assertEquals(m.title, 'Wrapping up Wednesday 👋')
  assertStringIncludes(m.body, 'Which of these did you knock out today?')
  assertStringIncludes(m.body, '1. Alpha\n2. Beta\n3. Gamma (not on board)')
  assertStringIncludes(m.body, 'rest day')
})

Deno.test('buildRecapMessage: done items drop off the list (matched by task text)', () => {
  const m = buildRecapMessage(inputs({ plan: planWithTasks, done: { a: true } }), ctx())
  assertNotMatch(m.body, /Alpha/) // done this morning → not asked about
  assertStringIncludes(m.body, '1. Beta\n2. Gamma (not on board)') // unmatched Gamma stays listed
})

Deno.test(
  'buildRecapMessage: a recurring chore done TODAY drops off (lastDoneAt, not done map)',
  () => {
    // Recurring tasks never set daily_state.done — completion resets recurring.lastDoneAt. A chore
    // done this morning must not be re-asked in the evening.
    const m = buildRecapMessage(
      inputs({
        plan: { bigRock: { task: 'Alpha' }, smallRocks: [{ task: 'Beta' }] },
        tasks: [
          {
            id: 'a',
            text: 'Alpha',
            x: 0.5,
            y: 0.5,
            due: null,
            due_time: null,
            staged: false,
            size: null,
            recurring: { frequencyDays: 7, lastDoneAt: '2026-07-07T15:00:00Z', doneCount: 3 },
          },
          {
            id: 'b',
            text: 'Beta',
            x: 0.2,
            y: 0.3,
            due: null,
            due_time: null,
            staged: false,
            size: null,
            recurring: null,
          },
        ],
      }),
      ctx(), // UTC, localDate 2026-07-07 → lastDoneAt is "today"
    )
    assertNotMatch(m.body, /Alpha/)
    assertStringIncludes(m.body, '1. Beta')
  },
)

Deno.test('buildRecapMessage: a recurring chore done YESTERDAY stays on the list', () => {
  const m = buildRecapMessage(
    inputs({
      plan: { bigRock: { task: 'Alpha' }, smallRocks: [] },
      tasks: [
        {
          id: 'a',
          text: 'Alpha',
          x: 0.5,
          y: 0.5,
          due: null,
          due_time: null,
          staged: false,
          size: null,
          recurring: { frequencyDays: 7, lastDoneAt: '2026-07-06T23:00:00Z', doneCount: 3 },
        },
      ],
    }),
    ctx(),
  )
  assertStringIncludes(m.body, '1. Alpha')
})

Deno.test('buildRecapMessage: whole plan finished → celebrate, no list', () => {
  const m = buildRecapMessage(
    inputs({
      plan: { bigRock: { task: 'Alpha' }, smallRocks: [{ task: 'Beta' }] },
      done: { a: true, b: true },
    }),
    ctx({ dayName: 'Friday' }),
  )
  assertEquals(m.title, 'Wrapping up Friday 🎉')
  assertStringIncludes(m.body, 'cleared the whole plan')
  assertNotMatch(m.body, /1\./)
})

Deno.test('buildRecapMessage: no plan on file → gentle generic check-in with board count', () => {
  const m = buildRecapMessage(inputs(), ctx({ dayName: 'Monday' }))
  assertEquals(m.title, 'Evening check-in 👋')
  assertStringIncludes(m.body, 'No morning plan on file today')
  assertStringIncludes(m.body, 'are 2 tasks on the board') // Alpha + Beta placed & open
  assertStringIncludes(m.body, 'No pressure either way 🙂')
})

Deno.test('buildRecapMessage: no plan AND empty board → check-in without a task nudge', () => {
  const m = buildRecapMessage(inputs({ tasks: [] }), ctx({ dayName: 'Monday' }))
  assertNotMatch(m.body, /on the board/)
})

Deno.test('buildRecapMessage: greeting uses the configured name', () => {
  const m = buildRecapMessage(
    inputs({ plan: planWithTasks, config: { notifications: { name: 'Braeden' } } }),
    ctx(),
  )
  assertStringIncludes(m.body, 'Hey Braeden! Which of these')
})

Deno.test('buildRecapMessage: an oversized plan list is capped with an "…and N more" line', () => {
  const smallRocks = Array.from({ length: 14 }, (_, i) => ({ task: `Item ${i + 1}` }))
  const m = buildRecapMessage(inputs({ plan: { smallRocks } }), ctx())
  assertStringIncludes(m.body, '10. Item 10')
  assertNotMatch(m.body, /11\. Item 11/)
  assertStringIncludes(m.body, '…and 4 more')
})

// ---- Malformed plan hardening (the column is opaque jsonb — any shape can arrive) ----------------

Deno.test('normalizePlan: rejects non-object shapes and coerces mis-typed fields', () => {
  assertEquals(normalizePlan(null), null)
  assertEquals(normalizePlan('a string'), null)
  assertEquals(normalizePlan([1, 2]), null)
  const p = normalizePlan({ headline: 42, bigRock: 'nope', smallRocks: 'also nope' })
  assertEquals(p, { headline: undefined, bigRock: null, smallRocks: [] })
})

Deno.test(
  'builders never throw on a mis-typed plan (numbers/strings where objects expected)',
  () => {
    const evil = { headline: 42, bigRock: 7, smallRocks: [null, 'x', { task: 9, duration: {} }] }
    const morning = buildMorningFromPlan(evil as unknown as DispatchPlan, inputs(), DAY)
    assertStringIncludes(morning.body, 'open day') // degrades to the open-day line, no crash
    const evening = buildRecapMessage(inputs({ plan: evil as unknown as DispatchPlan }), ctx())
    assertEquals(evening.title, 'Evening check-in 👋') // no usable items → generic check-in
  },
)

Deno.test('buildMorningFromPlan: quick wins capped at 10', () => {
  const smallRocks = Array.from({ length: 14 }, (_, i) => ({ task: `Win ${i + 1}` }))
  const m = buildMorningFromPlan({ headline: 'Busy.', smallRocks }, inputs(), DAY)
  assertStringIncludes(m.body, '• Win 10')
  assertNotMatch(m.body, /• Win 11/)
})
