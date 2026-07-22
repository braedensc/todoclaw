// Tests for the pure dispatcher logic (dispatch.ts): local-hour math, quiet-hours suppression, the
// due-kind decision, and the message content (plan-rich morning, plan-based evening check-in, and
// the deterministic fallbacks).
import { assert, assertEquals, assertStringIncludes, assertNotMatch } from 'jsr:@std/assert@1'
import { dayNameInTZ } from './dates.ts'
import {
  buildMorningFromPlan,
  buildMorningMessage,
  buildRecapMessage,
  dueKind,
  isEmptyDigest,
  isEmptyEvening,
  isEmptyMorning,
  isQuietHour,
  localHourInTZ,
  normalizePlan,
  recapPlanItems,
  upcomingItems,
  type DispatchInputs,
  type DispatchPlan,
  type NotificationPrefs,
  type RecapContext,
} from './dispatch.ts'
import type { ActivityRow } from './activity.ts'

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
  // Evening recovers the same way but stays inside the local day ([21, 24)) — never past midnight, or
  // the recap would read the next (empty) day's plan and claim its slot.
  assertEquals(dueKind(p, 23), 'recap')
  assertEquals(dueKind(p, 0), null) // rolled into the next day → recap is skipped, not misfired
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

Deno.test(
  'morning excludes a permanently completed one-off task (completed_at, not the done map)',
  () => {
    // The prior-day-completion leak: a one-off task marked done on an EARLIER day keeps completed_at
    // set but is absent from TODAY's done map (it reset at local midnight). dispatch_inputs_for_user
    // filters it at the SQL WHERE clause; the builders self-guard on completed_at too — either way it
    // must never reappear in the morning push.
    const withCompleted = inputs({
      tasks: [
        {
          id: 'live',
          text: 'Live meeting',
          x: 0.6,
          y: 0.6,
          due: DAY,
          due_time: '09:00:00',
          size: null,
          staged: false,
          recurring: null,
        },
        {
          id: 'done-oneoff',
          text: 'Finished errand',
          x: 0.7,
          y: 0.7,
          due: DAY,
          due_time: '10:00:00',
          size: null,
          staged: false,
          recurring: null,
          completed_at: '2026-07-03T18:00:00Z', // completed YESTERDAY; gone from today's done map
        },
      ],
    })

    // Plan-rich morning: the ⏰ TODAY anchor lists the live task only, never the completed one.
    const rich = buildMorningFromPlan(fullPlan, withCompleted, DAY)
    assertStringIncludes(rich.body, '⏰ TODAY\n• 9:00 AM — Live meeting')
    assertNotMatch(rich.body, /Finished errand/)

    // Deterministic fallback: the placed-task count and ⏰ TODAY both exclude the completed one.
    const fallback = buildMorningMessage(withCompleted, DAY)
    assertStringIncludes(fallback.body, '1 task and 1 habit on deck')
    assertNotMatch(fallback.body, /Finished errand/)
  },
)

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

Deno.test('buildRecapMessage: done items move to the crossed-off section (text match)', () => {
  const m = buildRecapMessage(inputs({ plan: planWithTasks, done: { a: true } }), ctx())
  assertStringIncludes(m.body, 'already crossed off:\n✓ Alpha') // acknowledged…
  assertNotMatch(m.body, /\d+\. Alpha/) // …never re-asked as an open item
  assertStringIncludes(m.body, "Still open from this morning's plan:")
  assertStringIncludes(m.body, '1. Beta\n2. Gamma (not on board)') // unmatched Gamma stays listed
  assertNotMatch(m.body, /rest day/) // things got done — the rest-day closer would ring false
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
    assertStringIncludes(m.body, '✓ Alpha') // acknowledged in the crossed-off section
    assertNotMatch(m.body, /\d+\. Alpha/)
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

Deno.test(
  'buildRecapMessage: a completed one-off is recognized by rock taskId even when completed_at ' +
    'hid its task row (the RPC filters completed tasks out, so text matching never sees it)',
  () => {
    const planned: DispatchPlan = {
      headline: 'x',
      bigRock: { task: 'Finish taxes', duration: '~1h', taskId: 'gone' },
      smallRocks: [{ task: 'Beta', taskId: 'b' }],
    }
    // 'gone' has no row in inputs.tasks — only today's done map (keyed by id) remembers it.
    const m = buildRecapMessage(inputs({ plan: planned, done: { gone: true } }), ctx())
    assertStringIncludes(m.body, '✓ Finish taxes')
    assertNotMatch(m.body, /\d+\. Finish taxes/)
    assertStringIncludes(m.body, '1. Beta')
  },
)

Deno.test(
  'buildRecapMessage: taskId links a paraphrased rock to its task row (completed_at / lastDoneAt)',
  () => {
    // The model may re-word a task ("Alpha" → "Knock out Alpha") — only the id can tie them.
    const m = buildRecapMessage(
      inputs({
        plan: {
          bigRock: { task: 'Knock out Alpha', taskId: 'a' },
          smallRocks: [
            { task: 'Chip at Rho', taskId: 'r' },
            { task: 'Beta', taskId: 'b' },
          ],
        },
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
            recurring: null,
            completed_at: '2026-07-07T15:00:00Z',
          },
          {
            id: 'r',
            text: 'Rho',
            x: 0.5,
            y: 0.5,
            due: null,
            due_time: null,
            staged: false,
            size: null,
            recurring: { frequencyDays: 7, lastDoneAt: '2026-07-07T14:00:00Z', doneCount: 2 },
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
      ctx(), // UTC, localDate 2026-07-07 → both completion stamps land "today"
    )
    assertStringIncludes(m.body, '✓ Knock out Alpha')
    assertStringIncludes(m.body, '✓ Chip at Rho')
    assertStringIncludes(m.body, '1. Beta')
    assertNotMatch(m.body, /\d+\. Knock out Alpha/)
  },
)

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

// ---- recapPlanItems / upcomingItems / activity-aware recap ---------------------------------------

const act = (kind: string, taskText = 'x'): ActivityRow => ({ kind, taskText, detail: {} })

Deno.test('recapPlanItems: splits the plan into done / open; hasPlan flags a real plan', () => {
  const r = recapPlanItems(inputs({ plan: planWithTasks, done: { a: true } }), ctx())
  assertEquals(r.hasPlan, true)
  assertEquals(r.done, ['Alpha'])
  assertEquals(r.open, ['Beta', 'Gamma (not on board)'])
  assertEquals(recapPlanItems(inputs(), ctx()).hasPlan, false)
})

Deno.test(
  'upcomingItems: due-soon (timed first) + recurring next-cycle, excludes done, drops far',
  () => {
    const tasks = [
      {
        id: 'd1',
        text: 'Dentist',
        x: 0.5,
        y: 0.5,
        due: '2026-07-08',
        due_time: '16:30:00',
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 'd2',
        text: 'Report',
        x: 0.5,
        y: 0.5,
        due: '2026-07-09',
        due_time: null,
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 'far',
        text: 'Faraway',
        x: 0.5,
        y: 0.5,
        due: '2026-07-20',
        due_time: null,
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 'done',
        text: 'DoneOne',
        x: 0.5,
        y: 0.5,
        due: '2026-07-08',
        due_time: null,
        staged: false,
        size: null,
        recurring: null,
      },
      {
        id: 'rec',
        text: 'Water',
        x: 0.5,
        y: 0.5,
        due: null,
        due_time: null,
        staged: false,
        size: null,
        recurring: { frequencyDays: 3, lastDoneAt: '2026-07-06T12:00:00Z', doneCount: 1 },
      },
    ]
    const up = upcomingItems(inputs({ tasks, done: { done: true } }), ctx())
    assertStringIncludes(up[0], 'Dentist') // timed → sorts first within tomorrow
    assertStringIncludes(up[0], '4:30 PM')
    assertStringIncludes(up[0], 'due tomorrow')
    assert(up.some((l) => l.startsWith('Report')))
    assert(up.some((l) => l.includes('Water') && l.includes('recurring'))) // next cycle 07-09
    assert(!up.some((l) => l.startsWith('Faraway'))) // beyond the window
    assert(!up.some((l) => l.startsWith('DoneOne'))) // done today → excluded
  },
)

Deno.test('buildRecapMessage: no plan but activity → credits the day with a tally', () => {
  const m = buildRecapMessage(inputs({ plan: null }), ctx(), [
    act('completed'),
    act('completed'),
    act('created'),
  ])
  assertStringIncludes(m.body, 'Nice work today — 2 done · 1 created')
})

Deno.test('buildRecapMessage: look-ahead line appears, but never double-lists a plan item', () => {
  const tasks = [
    {
      id: 'd1',
      text: 'Dentist',
      x: 0.5,
      y: 0.5,
      due: '2026-07-08',
      due_time: null,
      staged: false,
      size: null,
      recurring: null,
    },
  ]
  // Dentist is NOT a plan item → it belongs in the look-ahead.
  const m = buildRecapMessage(
    inputs({ tasks, plan: { bigRock: { task: 'Alpha' }, smallRocks: [] } }),
    ctx(),
    [],
  )
  assertStringIncludes(m.body, '🔭 Coming up: Dentist — due tomorrow')
  // Dentist IS the open plan item → listed once, not repeated in the look-ahead.
  const m2 = buildRecapMessage(
    inputs({ tasks, plan: { bigRock: { task: 'Dentist' }, smallRocks: [] } }),
    ctx(),
    [],
  )
  assertNotMatch(m2.body, /Coming up/)
  assertStringIncludes(m2.body, '1. Dentist')
})

Deno.test('isEmptyEvening: any activity makes the evening non-empty', () => {
  assertEquals(isEmptyEvening(inputs({ tasks: [], plan: null })), true)
  assertEquals(isEmptyEvening(inputs({ tasks: [], plan: null }), [act('completed')]), false)
})

// ---- Malformed plan hardening (the column is opaque jsonb — any shape can arrive) ----------------

Deno.test('normalizePlan: rejects non-object shapes and coerces mis-typed fields', () => {
  assertEquals(normalizePlan(null), null)
  assertEquals(normalizePlan('a string'), null)
  assertEquals(normalizePlan([1, 2]), null)
  const p = normalizePlan({ headline: 42, bigRock: 'nope', smallRocks: 'also nope' })
  assertEquals(p, { headline: undefined, bigRock: null, smallRocks: [] })
})

Deno.test('normalizePlan: carries rock taskId through, degrading a mis-typed one to absent', () => {
  const p = normalizePlan({
    bigRock: { task: 'X', taskId: 'id-1' },
    smallRocks: [{ task: 'Y', taskId: 42 }],
  })
  assertEquals(p?.bigRock?.taskId, 'id-1')
  assertEquals(p?.smallRocks?.[0]?.taskId, undefined)
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

// ---- "Quiet when empty" gate (opt-in: skip a digest that would have nothing to say) --------------

Deno.test('isEmptyMorning: true only on a genuine blank slate', () => {
  assertEquals(isEmptyMorning(inputs({ tasks: [], habits: [], plan: null }), DAY), true)
  assertEquals(isEmptyMorning(inputs({ habits: [], plan: null }), DAY), false) // default tasks are open
  assertEquals(isEmptyMorning(inputs({ tasks: [], plan: null }), DAY), false) // default habit is active
  // an existing plan with a rock is content, even with no tasks/habits
  assertEquals(
    isEmptyMorning(inputs({ tasks: [], habits: [], plan: { bigRock: { task: 'X' } } }), DAY),
    false,
  )
})

Deno.test('isEmptyMorning: a timed task today (even unplaced) keeps it non-empty', () => {
  const timed = inputs({
    tasks: [
      {
        id: 't',
        text: 'Call',
        x: null,
        y: null,
        due: DAY,
        due_time: '09:00:00',
        staged: true,
        size: null,
        recurring: null,
      },
    ],
    habits: [],
    plan: null,
  })
  assertEquals(isEmptyMorning(timed, DAY), false)
})

Deno.test('isEmptyEvening: true only with no plan AND an empty board', () => {
  assertEquals(isEmptyEvening(inputs({ tasks: [], plan: null })), true)
  assertEquals(isEmptyEvening(inputs({ plan: null })), false) // default tasks on the board
  // a plan to ask about (even if finished) is worth a recap
  assertEquals(isEmptyEvening(inputs({ tasks: [], plan: { bigRock: { task: 'X' } } })), false)
})

Deno.test(
  'isEmptyDigest: routes plan→morning, recap→evening (habits count for morning only)',
  () => {
    const blank = inputs({ tasks: [], habits: [], plan: null })
    assertEquals(isEmptyDigest('plan', blank, DAY), true)
    assertEquals(isEmptyDigest('recap', blank, DAY), true)
    // habit-only day: the morning has the habit to nudge; the evening ignores habits → empty.
    const habitOnly = inputs({ tasks: [], plan: null }) // default habit h1 is active
    assertEquals(isEmptyDigest('plan', habitOnly, DAY), false)
    assertEquals(isEmptyDigest('recap', habitOnly, DAY), true)
  },
)
