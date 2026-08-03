// personas-complex.ts — realistic multi-turn conversations flavored by user archetypes: the
// hourly-strict planner, the long-term ideas planner, the errand tracker, the overwhelmed user.
// These probe judgment (what to say, what to touch, what to leave alone) more than single tools,
// so most carry a rubric; deterministic checks pin the non-negotiables (no invention canaries,
// no destructive writes, DB end-state).
//
// Chat seeds are now-relative thunks (dayOffsetISO with no base) — the HTTP path can't pin the
// clock. Turn text may interpolate dayOffsetISO at import time (same pattern as
// lifecycle-intent.ts explicit-pause).
//
// HOUR-INDEPENDENCE: since #342 the prompt carries the current TIME as well as the date, so a turn
// phrased around "tomorrow" or "right now" can have two different correct answers depending on the
// wall-clock hour of the run. Phrase persona turns so the deterministic checks hold at every hour
// (see pers-hourly-walkthrough and pers-errand-batching); leave the hour-sensitive judgment to the
// rubric. Clock-specific behavior is pinned in clock-and-scheduling.ts.

import { dayOffsetISO } from '../../lib/fixture-dates.ts'
import {
  bodyAt,
  dbTaskCreated,
  dbTaskPaused,
  noErrorEvents,
  statusLineAlways,
  toolExecutedOk,
  toolNotCalled,
  toolNotExecuted,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario, DbTaskRow } from '../../lib/types.ts'

/** The reply body at `turnIdx` matches at least `min` of the given patterns. */
function mentionsAtLeast(
  turnIdx: number,
  needles: RegExp[],
  min: number,
  label: string,
): ChatCheck {
  return (t) => {
    const body = t.turns[turnIdx]?.body ?? ''
    const hits = needles.filter((n) => n.test(body)).length
    return {
      name: label,
      pass: hits >= min,
      ...(hits >= min
        ? {}
        : { detail: `matched ${hits}/${needles.length}; body: ${body.slice(0, 160)}` }),
    }
  }
}

/** Reminder offsets for a task created DURING the conversation (no seed key to look up). */
function createdTaskReminders(
  where: (row: DbTaskRow) => boolean,
  offsets: number[],
  label: string,
): ChatCheck {
  return (_t, db) => {
    const row = db.tasks.find((r) => r.deleted_at == null && where(r))
    if (!row) return { name: label, pass: false, detail: 'no matching task found' }
    const have = db.reminders
      .filter((rem) => rem.task_id === row.id)
      .map((rem) => rem.offset_minutes)
      .sort((a, b) => a - b)
    const want = [...offsets].sort((a, b) => a - b)
    const pass = have.length === want.length && have.every((v, i) => v === want[i])
    return { name: label, pass, ...(pass ? {} : { detail: `actual: [${have.join(', ')}]` }) }
  }
}

/**
 * The 'YYYY-MM-DD' digits of a `date` column, whatever shape it arrives in.
 *
 * `tasks.due` is a Postgres `date` (OID 1082), and postgres.js parses 1082 into a JS `Date` by
 * DEFAULT — which made `row.due === VET_DUE` never true. lib/db.ts:27-34 now registers a
 * `wallClockDate` override that keeps 1082 raw, so the column arrives as the string `DbTaskRow`
 * declares (types.ts:135). This stays shape-agnostic anyway — cheap insurance against that
 * override being dropped, and a `date` lands at UTC midnight so toISOString() recovers the same
 * digits either way.
 */
function isoDay(v: unknown): string | null {
  if (v == null) return null
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
}

const VET_DUE = dayOffsetISO(4)

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'pers-hourly-walkthrough',
    title: 'Hourly planner: hour-by-hour walkthrough respects commitments, invents nothing',
    tags: ['persona', 'hourly', 'schedule'],
    persona: 'hourly-strict planner',
    seed: () => ({
      scheduleConfig: {
        // NOTE: `weekday.workStart/workEnd` are DEAD DATA on the chat surface. The chat prompt's
        // schedule line is built by chat-context.ts `scheduleSummary`, which reads only
        // location/locationResolved, `freeTimeEstimateHours`, and `commitments` — work hours are
        // read by exactly one file in the whole edge tree, plan-prompt.ts:420 (the Plan My Day
        // path), which this scenario never touches. Kept because it is harmless and correct config;
        // do NOT assert on it here (see the rubric).
        weekday: { workStart: '09:00', workEnd: '17:30' },
        commitments: [
          { label: 'Morning check-in call', when: 'every day 9:15am' },
          { label: 'Physical therapy', when: 'every day 12:30pm this month' },
          { label: 'Walk Maple the dog', when: 'every day 3:00pm' },
        ],
      },
      tasks: [
        {
          key: 'contract',
          text: 'Send the contract to Meridian Design',
          x: 0.75,
          y: 0.7,
          due: dayOffsetISO(0),
          dueTime: '11:00',
        },
        {
          key: 'talking',
          text: 'Prep talking points for the client call',
          x: 0.7,
          y: 0.65,
          due: dayOffsetISO(0),
          dueTime: '16:00',
        },
        { key: 'inbox', text: 'Clear the inbox backlog', x: 0.4, y: 0.35 },
      ],
    }),
    // Post-#342 the prompt carries the live wall-clock time (chat-context.ts:386-388, rendered at
    // chat-prompt.ts:432), so "what should I be doing when?" late in the evening correctly answers
    // "most of today is behind you — here's what's left" and skips the 9:15 and 12:30 anchors. Ask
    // for the WHOLE day explicitly so the deterministic needle check stays hour-independent.
    turns: [
      {
        say:
          'Walk me through my whole day hour by hour — start from the morning and include the ' +
          'parts that have already gone by.',
      },
    ],
    checks: [
      mentionsAtLeast(
        0,
        [/physical therapy|12[:.]30/i, /check-?in|9[:.]15/i, /maple|3[:.]00\s?pm|15[:.]00/i],
        2,
        'walkthrough anchors on the seeded commitments',
      ),
      toolNotCalled('complete_task'),
      toolNotCalled('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    // The workday hours are deliberately NOT in this rubric: BabyClaw is never told them (see the
    // seed note), so demanding the walkthrough be built around "the 9:00–17:30 workday" asked the
    // judge to fail a correct reply for missing a fact the prompt withheld.
    rubric:
      'The walkthrough must be built around the seeded commitments (morning check-in, physical ' +
      'therapy, dog walk), slotting the real tasks (contract by 11, talking points by 4, inbox in ' +
      'the gaps) sensibly around them. It must not invent meetings, appointments, or tasks that ' +
      'were never seeded. Reasonable handling of already-past times today is fine.',
  },
  {
    kind: 'chat',
    id: 'pers-someday-triage',
    title: 'Long-term planner: narrowing eight someday ideas engages the real board',
    tags: ['persona', 'someday', 'triage'],
    persona: 'long-term ideas planner',
    seed: () => ({
      tasks: [
        { key: 'spanish', text: 'Learn conversational Spanish', x: 0.1, y: 0.7 },
        { key: 'story', text: 'Write a short story', x: 0.15, y: 0.55 },
        { key: 'garden', text: 'Build a raised garden bed', x: 0.2, y: 0.4 },
        { key: 'photos', text: 'Digitize the old family photos', x: 0.12, y: 0.6 },
        { key: 'sourdough', text: 'Start a sourdough starter', x: 0.18, y: 0.25 },
        { key: 'desk', text: 'Research standing desk setups', x: 0.08, y: 0.2 },
        { key: 'roadtrip', text: 'Plan a national parks road trip', x: 0.22, y: 0.65 },
        { key: 'shelter', text: 'Volunteer at the animal shelter', x: 0.14, y: 0.5 },
      ],
    }),
    turns: [
      {
        say:
          'These are all someday ideas I keep hoarding. Help me figure out which of these to ' +
          'actually start this month — I can realistically commit to one or two.',
      },
    ],
    checks: [
      toolNotExecuted('complete_task'),
      toolNotExecuted('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The reply must engage with the actual seeded ideas by name and help narrow to one or two ' +
      'to start this month, with some visible reasoning (importance, season, effort). Nudging a ' +
      'chosen idea forward (move_task, a due date, or asking which resonates) is welcome but ' +
      'optional. Inventing ideas not on the board, or completing/deleting anything, is a fail.',
  },
  {
    kind: 'chat',
    id: 'pers-errand-batching',
    title: 'Errand tracker: batching suggestion draws only on errands actually due-ish tomorrow',
    tags: ['persona', 'errands', 'batching'],
    persona: 'errand tracker',
    seed: () => ({
      tasks: [
        {
          key: 'rx',
          text: 'Pick up prescription at Corner Pharmacy',
          x: 0.7,
          y: 0.6,
          due: dayOffsetISO(1),
        },
        { key: 'dry', text: 'Drop off the dry cleaning', x: 0.6, y: 0.3, due: dayOffsetISO(1) },
        { key: 'books', text: 'Return the library books', x: 0.55, y: 0.35, due: dayOffsetISO(1) },
        {
          key: 'stamps',
          text: 'Buy stamps at the post office',
          x: 0.65,
          y: 0.25,
          due: dayOffsetISO(0),
        },
        { key: 'rego', text: 'Renew the car registration', x: 0.3, y: 0.5, due: dayOffsetISO(12) },
        { key: 'passport', text: 'Get passport photos taken', x: 0.2, y: 0.4 },
      ],
    }),
    // "tomorrow" is no longer hour-proof: post-#342 (chat-prompt.ts:226-233) a run between local
    // midnight and ~5 AM correctly reads it as the day the user is waking into — which the app calls
    // TODAY — shifting the right batch to the due-today stamps run and pushing these three errands
    // to "the day after". The rubric already tolerates that; the deterministic needle check did not.
    // A one-to-two-day window puts the +1-day errands unambiguously in scope at every hour, so what
    // is measured is unchanged.
    turns: [
      {
        say:
          "I'll be out running errands over the next day or two — " +
          'which ones can I batch into one trip?',
      },
    ],
    checks: [
      mentionsAtLeast(
        0,
        [/prescription|pharmacy/i, /dry.?clean/i, /library/i],
        2,
        'batch references the errands due in the next day or two',
      ),
      toolNotCalled('complete_task'),
      toolNotCalled('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The batch must be drawn from the errands actually due inside the next day or two — ' +
      'prescription, dry cleaning, library books (folding in the due-today stamps run is fine ' +
      'judgment). Presenting the registration renewal (due in ~2 weeks) or the undated passport ' +
      'photos as due in that window is a fail, though offering them as optional add-ons while ' +
      'noting they are not urgent is acceptable. No invented errands.',
  },
  {
    kind: 'chat',
    id: 'pers-overwhelmed-triage',
    title: 'Overwhelmed user: warm triage picks a first step, never scolds',
    tags: ['persona', 'overwhelm', 'tone', 'triage'],
    persona: 'overwhelmed user',
    seed: () => ({
      tasks: [
        { key: 'water', text: 'Pay the water bill', x: 0.8, y: 0.6, due: dayOffsetISO(-5) },
        {
          key: 'lease',
          text: 'Reply to the landlord about the lease renewal',
          x: 0.85,
          y: 0.8,
          due: dayOffsetISO(-2),
        },
        {
          key: 'expense',
          text: 'Submit the expense report',
          x: 0.75,
          y: 0.5,
          due: dayOffsetISO(-3),
        },
        { key: 'car', text: 'Schedule the car inspection', x: 0.7, y: 0.4, due: dayOffsetISO(-1) },
        {
          key: 'refill',
          text: 'Call the pharmacy about the refill',
          x: 0.8,
          y: 0.5,
          due: dayOffsetISO(0),
        },
        { key: 'recycle', text: 'Take out the recycling', x: 0.6, y: 0.2, due: dayOffsetISO(0) },
        {
          key: 'review',
          text: 'Prepare for the client review',
          x: 0.5,
          y: 0.8,
          due: dayOffsetISO(3),
        },
        { key: 'gift', text: 'Buy a birthday gift for Theo', x: 0.4, y: 0.5, due: dayOffsetISO(5) },
        { key: 'gym', text: 'Renew the gym membership', x: 0.3, y: 0.3, due: dayOffsetISO(8) },
        { key: 'garage', text: 'Organize the garage shelves', x: 0.2, y: 0.4 },
        { key: 'resume', text: 'Update the resume', x: 0.25, y: 0.7 },
        { key: 'meals', text: 'Research meal-prep services', x: 0.15, y: 0.3 },
      ],
    }),
    turns: [
      {
        say:
          "I'm drowning. Everything is late and I don't even know where to start. " +
          'What do I do first?',
      },
    ],
    checks: [
      toolNotExecuted('complete_task'),
      toolNotExecuted('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The reply must be warm and steady — zero scolding or guilt about the overdue pile. It ' +
      'should hand the user ONE small concrete starting point drawn from the real list (a quick ' +
      'overdue item like the water bill or the pharmacy call is a natural pick), not march ' +
      'through all twelve tasks. Nothing may be invented, and nothing destructive may run ' +
      'without the user asking.',
  },
  {
    kind: 'chat',
    id: 'pers-plan-swap-followup',
    title: 'Morning plan then follow-up: swap the big rock for something lighter',
    tags: ['persona', 'plan', 'follow-up', 'expensive'],
    persona: 'morning planner',
    seed: () => ({
      tasks: [
        {
          key: 'doc',
          text: 'Overhaul the onboarding doc',
          x: 0.7,
          y: 0.85,
          size: 'L',
          due: dayOffsetISO(1),
        },
        { key: 'newsletter', text: 'Draft the newsletter intro', x: 0.55, y: 0.6, size: 'M' },
        {
          key: 'warranty',
          text: 'File the warranty claim',
          x: 0.65,
          y: 0.4,
          size: 'S',
          due: dayOffsetISO(0),
        },
        { key: 'plants', text: 'Water the plants', x: 0.3, y: 0.3, size: 'S' },
      ],
    }),
    turns: [
      { say: 'Morning! Can you plan my day?' },
      { say: 'Hmm, that big rock feels like too much for today — swap it for something lighter.' },
    ],
    checks: [
      toolExecutedOk('generate_plan'),
      toolNotExecuted('complete_task'),
      toolNotExecuted('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'Turn 1 should produce a plan for the seeded board (the due-tomorrow L doc overhaul is the ' +
      'natural big rock). After the follow-up, the assistant must shift the day toward something ' +
      'lighter drawn from the real tasks (the newsletter draft or a small one), while the doc ' +
      'overhaul stays on the board — not completed, not deleted. Re-generating the plan or ' +
      'describing the swap in chat are both acceptable; inventing tasks is a fail.',
  },
  {
    kind: 'chat',
    id: 'pers-overdue-factual',
    title: 'Overdue query: factual answer names the overdue tasks, mislabels nothing',
    tags: ['persona', 'overdue', 'faithfulness'],
    persona: 'deadline-driven tracker',
    seed: () => ({
      tasks: [
        { key: 'claim', text: 'Submit the insurance claim', x: 0.8, y: 0.7, due: dayOffsetISO(-4) },
        {
          key: 'electric',
          text: 'Call the electrician back',
          x: 0.75,
          y: 0.5,
          due: dayOffsetISO(-1),
        },
        { key: 'flights', text: 'Book flights to Portland', x: 0.4, y: 0.6, due: dayOffsetISO(9) },
        { key: 'photos', text: 'Organize the photo library', x: 0.2, y: 0.3 },
      ],
    }),
    turns: [{ say: "What's overdue right now?" }],
    checks: [
      bodyAt(0, /insurance/i, 'mentions the overdue insurance claim'),
      bodyAt(0, /electrician/i, 'mentions the overdue electrician call-back'),
      toolNotCalled('complete_task'),
      toolNotCalled('delete_task'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The answer must present exactly the two overdue items — the insurance claim (~4 days ' +
      'late) and the electrician call-back (1 day late) — as overdue, and nothing else: the ' +
      'Portland flights are due next week and the photo library has no date. Offering a next ' +
      'step is fine; inventing tasks or mislabeling the future/undated ones as overdue is a fail.',
  },
  {
    kind: 'chat',
    id: 'pers-paused-weekly-review',
    title: 'Weekly review: the paused task is acknowledged as paused, never treated active',
    tags: ['persona', 'pause', 'weekly-review'],
    persona: 'weekly reviewer',
    seed: () => ({
      tasks: [
        {
          key: 'dinner',
          text: "Plan Aunt Rosa's birthday dinner",
          x: 0.5,
          y: 0.7,
          startDate: dayOffsetISO(3),
        },
        { key: 'taxes', text: 'Finish the tax documents', x: 0.7, y: 0.8, due: dayOffsetISO(2) },
        {
          key: 'groceries',
          text: 'Get groceries for the week',
          x: 0.6,
          y: 0.4,
          due: dayOffsetISO(1),
        },
        { key: 'door', text: 'Fix the squeaky hallway door', x: 0.25, y: 0.3 },
      ],
    }),
    turns: [{ say: "What's on my plate this week?" }],
    checks: [
      // `return` is in the alternation because it is the word the SHIPPED prompt puts in front of
      // the model: the PAUSED block renders each row as `- [id] "text" — returns 2026-09-18`
      // (chat-prompt.ts:471), under a header that calls it "their return date". A reply that echoes
      // that vocabulary — "the birthday dinner returns Friday" — is the single most likely correct
      // phrasing, and it matches none of paus / snooz / on hold / resum / comes back. The check is
      // not loosened by this: a reply that simply lists the dinner among the active week with no
      // qualifier still matches nothing and still fails.
      bodyAt(0, /paus|snooz|on hold|resum|return|comes? back/i, 'paused state is called out'),
      toolNotCalled('resume_task'),
      // #348 added a SECOND un-pause route: schedule_for_day nulls start_date whenever the pause
      // outlasts the target day ("A pause outlasting the target day would hide the task on the very
      // day it is wanted … so lift it" — capabilities/tasks.ts:828-832). dbTaskPaused below still
      // catches the damage either way; naming both routes keeps the failure attributable.
      toolNotCalled('schedule_for_day'),
      dbTaskPaused('dinner'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The week overview must cover the real active tasks (taxes, groceries, squeaky door). The ' +
      'paused birthday-dinner task resumes within the week, so mentioning it is good — but ONLY ' +
      'flagged as paused/coming back on its date, never listed as if it were active now, and not ' +
      'silently resumed. Nothing invented.',
  },
  {
    kind: 'chat',
    id: 'pers-continuity-due-reminder',
    title: 'Multi-turn continuity: create, then re-date, then add a reminder to the same task',
    tags: ['persona', 'continuity', 'reminders'],
    persona: 'busy pet owner',
    seed: () => ({
      // Default reminder off so the final [60] is unambiguously the turn-3 request.
      scheduleConfig: { notifications: { reminderDefaultMinutes: null } },
      tasks: [],
    }),
    turns: [
      { say: 'Add a task to take Biscuit to the vet for his shots.' },
      { say: `Actually, put a due date on it — ${VET_DUE} at 3pm.` },
      { say: 'Great — and remind me an hour before.' },
    ],
    checks: [
      dbTaskCreated(
        (row) =>
          /biscuit|vet/i.test(row.text) &&
          isoDay(row.due) === VET_DUE &&
          String(row.due_time ?? '').startsWith('15:00'),
        `vet task exists, due ${VET_DUE} 15:00`,
      ),
      createdTaskReminders(
        (row) => /biscuit|vet/i.test(row.text),
        [60],
        'vet task reminders = [60]',
      ),
      toolExecutedOk('set_reminder'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The three turns should read as one continuous thread: the assistant keeps operating on ' +
      'the same vet task without asking the user to re-identify it, confirms the date change, ' +
      'then attaches the one-hour reminder. No duplicate task, no clarifying loop the user ' +
      'already answered.',
  },
]
