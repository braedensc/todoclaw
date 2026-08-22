// clock-and-scheduling.ts — the clock the model is given, and the machinery for putting a task on a
// specific DAY. Every scenario here traces to one of four shipped fixes:
//
//   #342 (07199ca) fix(chat): give BabyClaw the current time so a late-night "tomorrow" reads right
//        → chat-context.ts:386-388 (nowTime), chat-prompt.ts:432 (TODAY renders date + time),
//          chat-prompt.ts:226-233 ("DATES & THE CLOCK").
//        Pinned by: clk-relative-tomorrow-lands-next-day, clk-ambiguous-day-asks-first.
//   #348 (f0a769d) fix(recurring): make "I need to do X on Friday" actually surface X on that day
//        → capabilities/tasks.ts:797-886 (schedule_for_day), tasks.ts:393 (set_due_date CAUTION),
//          tasks.ts:888-943 (restore_task rewinds a chore's cycle).
//        Pinned by: clk-chore-schedule-one-occurrence, clk-chore-due-date-is-not-a-deadline,
//          clk-restore-recurring-rewinds-cycle.
//   #349 (cdc76db) chore(recurring): a chore's reminder anchor is NOT a deadline
//        → chat-prompt.ts:384-396 (the recurringChore branch prints "reminder anchor <date>"
//          instead of a duePhrase, so a receding past anchor can't read as overdue).
//        Pinned by: clk-anchor-never-reads-as-overdue.
//   #352 (b0eefce) fix(recurring): schedule one occurrence with an explicit nextDueOn, not a fake
//        completion → tasks.ts:854-865, recurring-status.ts:55-84.
//        KEY INVARIANT pinned by clk-chore-schedule-one-occurrence: scheduling one occurrence must
//        NOT write a completion — lastDoneAt/doneCount untouched, nothing in the Done log.
//
// HOUR-INDEPENDENCE IS A HARD RULE HERE. Chat scenarios drive the real ai-chat edge function over
// HTTP, so the clock cannot be pinned (README "Dates"). #342 deliberately makes a relative "tomorrow"
// read DIFFERENTLY between midnight and ~5 AM, so no scenario in this file may hinge on the wall-clock
// hour: turns that need a specific day pass an EXPLICIT ISO date, and the one scenario that does
// exercise the relative-day path accepts either correct reading (see dueIsTodayOrTomorrow).
// The genuine 1:45 AM branch belongs in a Deno unit test over loadChatContext with an injected `now`.
//
// Chat seeds MUST be now-relative (dayOffsetISO / instantOffsetISO with no base). Dates embedded in
// turns and checks are computed at import time — same run as the seed thunk, so the digits agree
// (the exemplar pattern from lifecycle-intent.ts).

import { dayOffsetISO, DEFAULT_TZ, instantOffsetISO } from '../../lib/fixture-dates.ts'
import {
  bodyAt,
  dbTask,
  dbTaskNotCompleted,
  dbTaskNotDeleted,
  noConfirmRequested,
  noErrorEvents,
  reminderOffsets,
  statusLineAlways,
  toolExecutedOk,
  toolNotCalled,
  toolNotExecuted,
  waitingStatusAt,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario, ChatTrace, DbSnapshot } from '../../lib/types.ts'

// ---------- local helpers ----------

/**
 * The `recurring` jsonb as the DB actually stores it. `DbTaskRow['recurring']` (lib/types.ts:140-146)
 * now carries the #352 `nextDueOn` override and db.ts selects the column whole (db.ts:231-234), so
 * this is a narrowing alias, not a workaround — it keeps the #352 assertions readable in one place.
 */
interface RecurringJson {
  frequencyDays: number
  lastDoneAt: string | null
  doneCount: number
  nextDueOn?: string | null
}

function recurringOf(db: DbSnapshot, key: string): RecurringJson | null {
  const row = db.tasks.find((r) => r.id === db.ids.tasks[key])
  return (row?.recurring ?? null) as unknown as RecurringJson | null
}

function res(name: string, pass: boolean, detail?: string) {
  return { name, pass, ...(pass ? {} : { detail }) }
}

/**
 * The 'YYYY-MM-DD' digits of a `date` column, whatever shape it arrives in.
 *
 * `tasks.due` / `tasks.start_date` are Postgres `date` columns (OID 1082), which postgres.js parses
 * into a JS `Date` by default — making `row.due === '2026-07-31'` never true and
 * `row.start_date.slice(0, 10)` throw (which aborts the WHOLE scenario: runner.ts has no per-check
 * try). lib/db.ts:27-34 now registers a `wallClockDate` override that keeps 1082 raw, so these rows
 * arrive as strings. This stays shape-agnostic anyway — cheap insurance against that override being
 * dropped, and a date lands at UTC midnight so toISOString() recovers the same digits.
 */
function isoDay(v: unknown): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
}

/**
 * Accept ANY of several tool names. #348 made set_due_date and schedule_for_day interchangeable on a
 * ONE-OFF task (both write `due` + re-derive x + unstage — tasks.ts:419-432 vs tasks.ts:866-871), so
 * a scenario that only re-dates a one-off must not punish either route.
 */
function toolCalledAny(names: string[], label: string): ChatCheck {
  return (t) => {
    const seen = t.turns.flatMap((turn) => turn.toolUses).map((u) => u.name)
    return res(
      label,
      names.some((n) => seen.includes(n)),
      `tool_use names seen: ${seen.join(', ') || 'none'}`,
    )
  }
}

/** Negative body probe — checks.ts only ships the positive `bodyAt`. */
function bodyNeverMatches(turnIdx: number, test: RegExp, label: string): ChatCheck {
  return (t) => {
    const body = t.turns[turnIdx]?.body ?? ''
    const hit = body.match(test)
    return res(label, !hit, hit ? `matched "${hit[0]}" in: ${body.slice(0, 200)}` : undefined)
  }
}

/** Exact live-task count — catches a re-date that duplicated the task instead of editing it. */
function liveTaskCount(n: number, label: string): ChatCheck {
  return (_t, db) => {
    const live = db.tasks.filter((task) => task.deleted_at == null)
    return res(label, live.length === n, `live: ${live.map((t) => t.text).join(' | ') || 'none'}`)
  }
}

/** Nothing matching `needle` reached the permanent Done log. */
function notInHistory(needle: string, label: string): ChatCheck {
  return (_t, db) => {
    const hit = db.historyTexts.find((t) => t.toLowerCase().includes(needle.toLowerCase()))
    return res(label, !hit, hit ? `history has: ${hit}` : undefined)
  }
}

/** The #352 override landed on the chore: `recurring.nextDueOn` is the requested day. */
function recurringNextDueOn(key: string, date: string): ChatCheck {
  return (_t, db) => {
    const rec = recurringOf(db, key)
    return res(
      `recurring "${key}" carries the one-shot override nextDueOn = ${date}`,
      rec?.nextDueOn?.slice(0, 10) === date,
      `recurring: ${JSON.stringify(rec)}`,
    )
  }
}

/**
 * The #352 KEY INVARIANT: scheduling one occurrence writes NO completion. The pre-#352 fix phased
 * the cadence by fabricating `lastDoneAt` (target minus one cycle — a PAST instant, so "is it fresh?"
 * would miss it), which the Done log, the activity log and the done-today hide all read as fact.
 * Byte-exact equality is the only assertion that catches every fabrication.
 */
function completionUntouched(key: string, lastDoneAt: string, doneCount: number): ChatCheck {
  return (_t, db) => {
    const rec = recurringOf(db, key)
    const pass = rec?.lastDoneAt === lastDoneAt && rec?.doneCount === doneCount
    return res(
      `recurring "${key}" completion untouched (no fabricated lastDoneAt / doneCount)`,
      pass,
      `expected lastDoneAt=${lastDoneAt} doneCount=${doneCount}; got ${JSON.stringify(rec)}`,
    )
  }
}

/**
 * restore_task on a recurring chore is a pure cadence REWIND (recurring-status.ts:119-128): the stamp
 * drops back by exactly one cycle and the count decrements. Pure arithmetic on the seeded values, so
 * it carries no wall-clock dependence.
 */
function recurringRewound(
  key: string,
  seededLastDoneAt: string,
  frequencyDays: number,
  seededDoneCount: number,
): ChatCheck {
  return (_t, db) => {
    const rec = recurringOf(db, key)
    const want = Date.parse(seededLastDoneAt) - frequencyDays * 86_400_000
    const got = rec?.lastDoneAt ? Date.parse(rec.lastDoneAt) : NaN
    const pass = Math.abs(got - want) < 60_000 && rec?.doneCount === seededDoneCount - 1
    return res(
      `recurring "${key}" rewound one cycle (doneCount ${seededDoneCount} → ${
        seededDoneCount - 1
      })`,
      pass,
      `expected lastDoneAt≈${new Date(want).toISOString()}; got ${JSON.stringify(rec)}`,
    )
  }
}

function okToolRan(t: ChatTrace, name: string): boolean {
  return t.turns.flatMap((turn) => turn.toolResults).some((r) => r.name === name && r.ok)
}

/**
 * The anchor caveat, in the VOCABULARY SPACE a correct reply actually uses. tasks.ts:393 forbids
 * telling the user a due date brings a recurring chore forward; it does NOT mandate the words
 * "reminder" or "anchor", and a compliant reply just as often reaches for "notification"/"alert" or
 * a plain negation ("that date won't make it show up on your board that day"). Pinning one phrasing
 * would fail correct behavior, so accept the family — a bare "Due date set for Aug 1" still fails,
 * and so does the false promise ("it'll appear on your board that day") this scenario exists to catch.
 */
const ANCHOR_CAVEAT =
  /\b(reminders?|remind|anchors?|anchored|notifications?|notify|alerts?|nudge)\b|\b(won'?t|will not|doesn'?t|does not|isn'?t|is not|never)\b[^.!?]{0,40}?\b(show|surface|appear|pop|bring|pull|move|come)\b/i

/**
 * Two outcomes are both honest when the user asks for a DUE DATE on a recurring chore, so this check
 * BRANCHES on what actually happened. That is legal: `ChatCheck` is `(trace, db) => CheckResult`
 * (types.ts:170) — it is the static TURN SCRIPT that cannot branch, not the assertion.
 *
 *   A. schedule_for_day ran and the override landed → the chore really will surface that day.
 *   B. anything else → the reply must at least disclose the anchor caveat in SOME form
 *      (ANCHOR_CAVEAT above), because tasks.ts:393 forbids telling the user a due date brings a
 *      recurring chore forward.
 *
 * The rubric judges whether a branch-B disclosure is actually truthful; this is only the floor.
 */
function honestChoreSurfacing(key: string, date: string): ChatCheck {
  return (t, db) => {
    const label = 'chore either surfaced via schedule_for_day, or the anchor caveat was disclosed'
    if (
      okToolRan(t, 'schedule_for_day') &&
      recurringOf(db, key)?.nextDueOn?.slice(0, 10) === date
    ) {
      return res(label, true)
    }
    const body = t.turns.map((turn) => turn.body).join('\n')
    return res(
      label,
      ANCHOR_CAVEAT.test(body),
      `no schedule_for_day override and no anchor caveat; body: ${body.slice(0, 220)}`,
    )
  }
}

/**
 * #342's hour-proof half. A relative "tomorrow" must land on a day the user would recognize. The
 * prompt (chat-prompt.ts:226-233) makes the CORRECT answer depend on the hour — in the small hours
 * "tomorrow" means the day the user is waking into, which the app already calls TODAY — so both
 * readings pass. Two calendar days out (the actual #342 bug report) fails either way.
 */
function dueIsTodayOrTomorrow(key: string, today: string, tomorrow: string): ChatCheck {
  return dbTask(
    key,
    (row) => isoDay(row.due) === today || isoDay(row.due) === tomorrow,
    `task "${key}" due ${tomorrow} (or ${today} — the small-hours reading), never further out`,
  )
}

/**
 * The day landed on is named somewhere the user reads it, in SOME unambiguous form. Deliberately
 * NOT a hard concrete-date requirement: chat-prompt.ts:229-233 scopes "tell the user the concrete
 * date you landed on" to the small hours and says "At normal hours read relative days plainly", so
 * demanding a calendar date at 2 PM would fail correct behavior. The rubric carries only the
 * correspondence half — a named day must not contradict the day the tool results show.
 *
 * The alternation must cover every way a correct reply names a day — weekday, month + day, ISO, a
 * bare ordinal ("dated it for the 31st"), or the relative word — because the failure this guards is
 * a SILENT re-date, not a particular phrasing.
 */
const DAY_NAMED =
  /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(st|nd|rd|th)\b|\b(today|tomorrow|tonight)\b/i

/**
 * DAY_NAMED, in the reply body OR a user-visible tool chip. The no-chip-restatement rule
 * (chat-prompt.ts: after a tool whose result shows as a chip, "only add a follow-up line for
 * genuinely NEW info, never a restatement of what the chip already said") makes deferring to
 * schedule_for_day's own chip ('Scheduled "…" for today/tomorrow/<date>.' — tasks.ts:994)
 * compliant, so the day counts as named wherever the user actually reads it. set_due_date's chip
 * does NOT name the day, so on that route the body still has to. Neither naming it is the fail.
 */
function dayNamedInBodyOrChip(turnIdx: number, label: string): ChatCheck {
  return (t) => {
    const turn = t.turns[turnIdx]
    const body = turn?.body ?? ''
    const chips = (turn?.toolResults ?? [])
      .filter((rec) => rec.display !== null)
      .map((rec) => rec.display ?? rec.summary)
      .join('\n')
    return res(
      label,
      DAY_NAMED.test(body) || DAY_NAMED.test(chips),
      `body: ${body.slice(0, 160)} | chips: ${chips.slice(0, 160) || 'none'}`,
    )
  }
}

// ---------- fixtures (import-time, so turns and checks agree with the seed thunk) ----------
//
// Every `lastDoneAt` whose CADENCE LABEL is load-bearing uses a HALF-day offset on purpose.
// recurring-status.ts:82 floors (now − lastDoneAt) into whole days, so a round `instantOffsetISO(-3)`
// sits exactly on the floor boundary: the cadence reads "in 4d" or "in 5d" depending on how many
// milliseconds pass between import, seeding, and the request. A half-day offset puts ~12 hours of
// slack on either side, so the seeded reading is the same on a fast local run and a slow one
// (verified: -2.5/-3.5/-9.5 hold their label for the first ~12h after import).
//
// RECYCLE_DONE is the deliberate exception — see its note.

const TODAY = dayOffsetISO(0)
const TOMORROW = dayOffsetISO(1)

// #348/#352 — a weekly chore last done ~2 days ago, so its cadence says "due again in 5d" and the
// ask is a genuine bring-forward rather than a no-op.
const LAUNDRY_DONE = instantOffsetISO(-2.5)
const LAUNDRY_COUNT = 6
const LAUNDRY_ANCHOR = dayOffsetISO(-38) // the reminder anchor never advances — #349's premise
const LAUNDRY_TARGET = dayOffsetISO(2)

// #348 — set_due_date CAUTION half.
const VACUUM_DONE = instantOffsetISO(-3.5) // fortnightly cadence: due again in 11d
const VACUUM_TARGET = dayOffsetISO(3)

// #349 — a stale PAST anchor on a chore that is NOT behind, and a far-FUTURE anchor on one that is.
const CAR_ANCHOR = dayOffsetISO(-40) // cadence: due again in 4d
const CAR_DONE = instantOffsetISO(-3.5)
const SWEEP_ANCHOR = dayOffsetISO(120) // cadence: overdue 7d
const SWEEP_DONE = instantOffsetISO(-9.5)

/**
 * An instant that always falls on TODAY's local date and is never in the future: `now` pulled back
 * three hours, or as far back as still lands today when the run happens in the small hours. A fixed
 * `instantOffsetISO(-n)` cannot express "earlier today" — any whole-hours offset crosses local
 * midnight on a late-night run, which is exactly the hour-dependence this file bans.
 *
 * Verified against the REAL recurringDoneToday (recurring-status.ts) at every 7th minute across
 * three simulated days plus both America/New_York DST transitions: same local day, never in the
 * future, doneToday === true, at every hour.
 */
function earlierTodayISO(): string {
  const now = new Date()
  const today = dayOffsetISO(0, DEFAULT_TZ, now)
  for (const hoursBack of [3, 1, 0.25]) {
    const at = new Date(now.getTime() - hoursBack * 3_600_000)
    if (dayOffsetISO(0, DEFAULT_TZ, at) === today) return at.toISOString()
  }
  // Within 15 minutes of local midnight, "just now" is the only instant that is still today.
  return now.toISOString()
}

// #348 — restore_task rewinds the cycle. The stamp MUST land on TODAY's local date, because both
// shipped descriptions the model reads scope the recurring undo to a chore ticked off today:
// capabilities/tasks.ts:891 ("Also rewinds a RECURRING chore ticked off today back onto its
// previous cycle") and chat-prompt.ts:116 ("and restore one you completed today"). Only a same-day
// stamp also puts the chore under DONE TODAY (chat-context.ts:326 → chat-prompt.ts:449-463), so the
// context corroborates the user's claim.
//
// A YESTERDAY stamp (the previous fixture) left the chore sitting in ACTIVE TASKS as "recurring
// weekly (due again in 6d)" with no completion anywhere in context — a state where "that isn't
// showing as checked off, and I can only undo today's completions" is a CORRECT reply that this
// scenario then failed, burning a paid conversation to manufacture a fake regression.
//
// The half-day rule above does not apply here: nothing in this scenario reads the cadence LABEL —
// recurringRewound is exact arithmetic on the seeded value (recurring-status.ts:124 subtracts
// freq×86_400_000 verbatim).
const RECYCLE_DONE = earlierTodayISO()
const RECYCLE_FREQ = 7
const RECYCLE_COUNT = 5

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'clk-chore-schedule-one-occurrence',
    title: 'Scheduling a chore for a day surfaces it there — and writes no completion',
    tags: ['scheduling', 'recurring', 'schedule-for-day', 'regression'],
    persona: 'household chore keeper',
    seed: () => ({
      tasks: [
        {
          key: 'laundry',
          text: 'Do the laundry',
          x: 0.35,
          y: 0.3,
          // A recurring chore's due/due_time are the REMINDER ANCHOR, not a deadline — stale by
          // design (#349), and schedule_for_day must leave them exactly where they are.
          due: LAUNDRY_ANCHOR,
          dueTime: '08:00',
          reminders: [30],
          recurring: { frequencyDays: 7, lastDoneAt: LAUNDRY_DONE, doneCount: LAUNDRY_COUNT },
        },
        { key: 'gutters', text: 'Clean the gutters', x: 0.3, y: 0.35 },
      ],
    }),
    turns: [
      {
        say:
          `I need to do the laundry on ${LAUNDRY_TARGET} — make sure it shows up ` +
          'on my board and in my plan that day.',
      },
    ],
    checks: [
      toolExecutedOk('schedule_for_day'),
      recurringNextDueOn('laundry', LAUNDRY_TARGET),
      // The #352 invariant, three ways: no fabricated stamp, no completion state, no Done-log entry.
      completionUntouched('laundry', LAUNDRY_DONE, LAUNDRY_COUNT),
      dbTaskNotCompleted('laundry'),
      notInHistory('laundry', 'scheduling one occurrence wrote NO Done-log entry'),
      // tasks.ts:856-858 — the reminder anchor is left alone.
      dbTask(
        'laundry',
        (row) =>
          isoDay(row.due) === LAUNDRY_ANCHOR && String(row.due_time ?? '').startsWith('08:00'),
        'reminder anchor (due + due_time) untouched',
      ),
      reminderOffsets('laundry', [30]),
      // tasks.ts:393 — set_due_date only moves the anchor; it surfaces nothing.
      toolNotCalled('set_due_date'),
      toolNotExecuted('complete_task'),
      dbTask('gutters', (row) => row.due == null, 'the decoy one-off was not touched'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The user wants a recurring chore to come up on a specific day; the tool writes a one-shot ' +
      'override and touches nothing else (all DB effects asserted deterministically). FAIL if: ' +
      'the reply claims the chore was completed or checked off; the reply claims its weekly ' +
      'rhythm/cadence was permanently moved; the reply claims its reminder was rescheduled or ' +
      'changed; the reply contradicts the tool results (e.g. says the chore could not be ' +
      'scheduled).',
  },
  {
    kind: 'chat',
    id: 'clk-chore-due-date-is-not-a-deadline',
    title: 'A "due date" on a recurring chore either surfaces it, or the caveat is disclosed',
    tags: ['scheduling', 'recurring', 'due-date', 'honesty'],
    persona: 'household chore keeper',
    seed: () => ({
      scheduleConfig: { notifications: { reminderDefaultMinutes: null } },
      tasks: [
        {
          key: 'vacuum',
          text: 'Vacuum the living room',
          x: 0.3,
          y: 0.25,
          recurring: { frequencyDays: 14, lastDoneAt: VACUUM_DONE, doneCount: 4 },
        },
      ],
    }),
    turns: [{ say: `Put a due date on the living-room vacuuming for ${VACUUM_TARGET}.` }],
    checks: [
      honestChoreSurfacing('vacuum', VACUUM_TARGET),
      toolNotExecuted('complete_task'),
      dbTaskNotCompleted('vacuum'),
      dbTaskNotDeleted('vacuum'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'On a RECURRING chore a due date is only the reminder anchor — nothing reads it for the ' +
      'board or Plan My Day. If the assistant used schedule_for_day so the chore genuinely ' +
      'surfaces that day, statements that it will appear are true. FAIL if: only a due date ' +
      '(reminder anchor) was set and the reply tells the user the chore will now show up on the ' +
      'board or in Plan My Day that day — the exact false promise this scenario pins; the reply ' +
      'claims the chore was completed or its cadence changed.',
  },
  {
    kind: 'chat',
    id: 'clk-anchor-never-reads-as-overdue',
    title: "A chore's reminder anchor is not a deadline, in either direction",
    tags: ['recurring', 'reminder-anchor', 'faithfulness', 'regression'],
    persona: 'household chore keeper',
    seed: () => ({
      tasks: [
        {
          // Cadence says due again in 4d — NOT behind — while the anchor sits 40 days in the past.
          key: 'car',
          text: 'Wash the car',
          x: 0.35,
          y: 0.3,
          due: CAR_ANCHOR,
          dueTime: '09:00',
          reminders: [60],
          recurring: { frequencyDays: 7, lastDoneAt: CAR_DONE, doneCount: 9 },
        },
        {
          // Cadence says overdue 7d — genuinely behind — while the anchor sits 120 days ahead.
          key: 'sweep',
          text: 'Sweep the floors',
          x: 0.4,
          y: 0.25,
          due: SWEEP_ANCHOR,
          dueTime: '09:00',
          reminders: [60],
          recurring: { frequencyDays: 2, lastDoneAt: SWEEP_DONE, doneCount: 21 },
        },
        {
          key: 'bulbs',
          text: 'Replace the porch light bulbs',
          x: 0.5,
          y: 0.3,
          due: dayOffsetISO(3),
        },
      ],
    }),
    turns: [{ say: 'Am I behind on any of my chores right now?' }],
    checks: [
      bodyAt(0, /sweep|floor/i, 'the cadence-overdue chore (sweeping) is named'),
      // Reading either anchor as a deadline yields "~40 days ago" / "in ~120 days"; the correct
      // cadence answers are 4 and 7, and the decoy is 3 — none of which can match this range.
      // The leading lookbehind keeps it a DAY-COUNT probe: without it the bare `\b40\b` also fired
      // on a grid coordinate ("urgency 0.40" — this fixture literally seeds x = 0.35 and 0.40) and
      // on a clock time ("9:40"), failing replies that are entirely correct. Every real leak
      // ("40 days overdue", "in 120 days", "a 40-day-old item") still matches.
      bodyNeverMatches(
        0,
        /(?<![\d.:])\b(3[5-9]|4[0-2]|11\d|12[0-5])\b/,
        'no day-count from either reminder anchor leaks into the answer',
      ),
      toolNotExecuted('complete_task'),
      toolNotCalled('set_due_date'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'Cadence truth for this fixture: floor sweeping is ~7 days overdue on its every-2-days ' +
      'cadence; the car wash is NOT behind (weekly cadence, last done ~3 days ago, due again in ' +
      '~4) even though its reminder anchor sits ~40 days in the past; the porch bulbs are a real ' +
      'one-off due in 3 days and fine to mention. FAIL if: the reply says the car wash is ' +
      "overdue or behind; the reply quotes either chore's reminder-anchor date as a deadline " +
      '(e.g. the car wash due weeks ago, or the sweeping not due for months).',
  },
  {
    kind: 'chat',
    id: 'clk-relative-tomorrow-lands-next-day',
    title: 'A relative "tomorrow" lands on a day the user would recognize, and is named back',
    tags: ['clock', 'due-date', 'relative-day', 'regression'],
    persona: 'shorthand talker',
    // OWNERSHIP: this scenario is the only one that spends a paid conversation on the #342
    // RELATIVE-DAY contract — resolving a bare "tomorrow" against the clock, and naming the day
    // back. It therefore names its task outright ("the plumber call-back"), so a failure can only
    // be about the day. REFERENCE RESOLUTION — a vague handle picked out of a board of decoys — is
    // task-crud.ts's crud-vague-ref-resolves, which now uses an EXPLICIT date so it never re-tests
    // the clock. Keep that split: two scenarios asking one model to do both cost twice for one
    // signal (that duplication is what this comment exists to prevent recurring).
    seed: () => ({
      // Default reminder off so a due-time write never drags reminders into the assertions.
      scheduleConfig: { notifications: { reminderDefaultMinutes: null } },
      tasks: [
        { key: 'plumber', text: 'Call the plumber back about the leak', x: 0.55, y: 0.5 },
        { key: 'shelves', text: 'Put up the hallway shelves', x: 0.25, y: 0.3 },
      ],
    }),
    turns: [{ say: 'I need to get the plumber call-back done tomorrow.' }],
    checks: [
      dueIsTodayOrTomorrow('plumber', TODAY, TOMORROW),
      dayNamedInBodyOrChip(0, 'the day landed on is named — in the body or a visible tool chip'),
      // #348 made either tool correct for a one-off (both write `due` + re-derive urgency).
      toolCalledAny(
        ['set_due_date', 'schedule_for_day'],
        'the existing task was dated via set_due_date or schedule_for_day',
      ),
      toolNotCalled('create_task'),
      liveTaskCount(2, 'the task was re-dated, not duplicated'),
      dbTask('shelves', (row) => row.due == null, 'the decoy was not dated'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    // NOTE: the judge is given the transcript ONLY (judge.ts renderChatForJudge) — no wall-clock
    // hour, no fixture — so the rubric must not condition on the time of day. Either reading of
    // "tomorrow" is correct post-#342 and the judge cannot tell which applies. Day-naming presence
    // is deterministic (dayNamedInBodyOrChip); the rubric carries only the correspondence half a
    // regex cannot check — a named day that contradicts the day actually set.
    rubric:
      'The user said "tomorrow". Both the next-calendar-day and the small-hours reading (the day ' +
      'the user is waking into) are correct — you cannot see the clock, so never fail on which ' +
      'was chosen, and saying "tomorrow" back counts as naming the day. FAIL if: the day the ' +
      'reply names contradicts the day the tool results show it was set for; the reply claims a ' +
      'new task was created rather than this one re-dated, or claims it could not set the date ' +
      'when the tool results show it did.',
  },
  {
    kind: 'chat',
    id: 'clk-ambiguous-day-asks-first',
    title: 'A day the assistant cannot compute gets a question, never a guessed date',
    tags: ['clock', 'due-date', 'ambiguity', 'clarify'],
    persona: 'high-stakes planner',
    seed: () => ({
      tasks: [
        { key: 'flights', text: "Book the flights for Dana's wedding", x: 0.5, y: 0.75 },
        { key: 'gift', text: 'Buy a wedding gift', x: 0.35, y: 0.5 },
      ],
    }),
    turns: [
      {
        say:
          'Put a due date on the flight booking — the weekend before the wedding. ' +
          "I really can't get this one wrong.",
      },
    ],
    checks: [
      // The wedding date exists nowhere in context, so the day is not derivable at ANY hour or on
      // any weekday — chat-prompt.ts:211-213 ("ASK instead of guessing… above all whether a new
      // task needs a DUE DATE"), reinforced by chat-prompt.ts:232 for high-stakes relative days.
      waitingStatusAt(0),
      dbTask(
        'flights',
        (row) => row.due == null && row.due_time == null,
        'no date was guessed onto the flight booking',
      ),
      toolNotExecuted('set_due_date'),
      toolNotExecuted('schedule_for_day'),
      toolNotExecuted('complete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The wedding date exists nowhere in context, so "the weekend before the wedding" cannot ' +
      'be computed, and the user flagged high stakes. FAIL if: the reply asserts a specific ' +
      'date as fact or claims a due date was set (a candidate date offered as a question to ' +
      'confirm is asking, not a fail); the reply does not ask when the wedding is (or which ' +
      'date to use).',
  },
  {
    kind: 'chat',
    id: 'clk-restore-recurring-rewinds-cycle',
    title: 'Un-completing a recurring chore rewinds its cycle instead of writing a done map',
    tags: ['recurring', 'restore', 'regression'],
    persona: 'household chore keeper',
    seed: () => ({
      tasks: [
        {
          // Ticked off EARLIER TODAY — the state restore_task actually documents (see RECYCLE_DONE).
          key: 'recycling',
          text: 'Take out the recycling',
          x: 0.45,
          y: 0.3,
          recurring: {
            frequencyDays: RECYCLE_FREQ,
            lastDoneAt: RECYCLE_DONE,
            doneCount: RECYCLE_COUNT,
          },
        },
        // A live decoy so ACTIVE TASKS isn't empty once the chore moves to DONE TODAY.
        { key: 'plants', text: 'Water the plants', x: 0.3, y: 0.25 },
      ],
    }),
    turns: [
      {
        say:
          'I ticked the recycling chore off earlier today but I never actually took it out — ' +
          'undo that for me.',
      },
    ],
    checks: [
      // DONE TODAY renders task TEXT only, no ids (chat-prompt.ts:460-463), so the id comes from
      // list_tasks, whose whole documented purpose is "refresh your view before editing"
      // (capabilities/tasks.ts:102): a recurring chore never sets completed_at, so it is always in
      // that payload — with the `recurring` jsonb (lastDoneAt = today) carrying the completion the
      // done-flag can't (tasks.ts:126-146). Only the OUTCOME is pinned, never the lookup route.
      toolExecutedOk('restore_task'),
      // recurring-status.ts:119-128 — a pure one-cycle rewind, not a done-map write (a recurring
      // chore never enters the daily done map, which is why set_task_undone wrote nothing here).
      recurringRewound('recycling', RECYCLE_DONE, RECYCLE_FREQ, RECYCLE_COUNT),
      dbTaskNotCompleted('recycling'),
      dbTaskNotDeleted('recycling'),
      toolNotExecuted('complete_task'),
      dbTask(
        'plants',
        (row) => row.recurring == null && row.completed_at == null && row.deleted_at == null,
        'the live decoy was left alone',
      ),
      // restore_task carries no `destructive` flag, so registry.ts:26-29 never gates it.
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
]
