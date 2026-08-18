// plan-anchors-and-load.ts — "a fixed commitment COSTS the day" (#345), plus the anchor × chore
// load interactions #344 and #351 left uncovered.
//
// Why each scenario exists (all four trace to a real reported board):
//  • panchor-halfday-anchor-vs-parked-project — #345, the exact report: a 2 PM half-day shop
//    appointment sat in the fixed-times strip while the card quoted the schedule's FULL 4.5h and
//    handed a 1.5h focus session to an ongoing project deliberately parked bottom-left. Nothing in
//    evals/ reproduced it (#345 shipped without touching a single eval file).
//  • panchor-unsized-anchor-judged-on-what-it-is — #345's second half: an UNSIZED anchor carries
//    `duration: null`, so the cost is the model's own read of what the thing is ("a mechanic
//    leaving a car up on a lift is not a 15-minute errand" — plan-prompt.ts's FIXED TIMES block).
//  • panchor-anchor-not-squeezed-by-due-today-crowd — #344 with the board that actually reproduces
//    the squeeze: an anchor barred from the big rock PLUS two due-today items filling both quick-win
//    slots (the existing pedge-timed-anchor has one competitor, so pre-#344 code had room). The
//    undated L distractor carries the size rules rather than #351's precedence rule — see the
//    check list there for why precedence cannot fail independently on this board.
//  • panchor-anchor-plus-due-chores-scale-the-day — #344 × #351: a day carrying BOTH derived strips
//    at once. Every existing chore scenario has no anchor; every anchor scenario has no chores.
//
// This file also owns the #345 anchor/chore combinators, because evals/lib is off-limits to
// per-family authors and they belong with the family that introduced them. Who actually imports
// what (keep this list honest — a wrong map sends the next editor to the wrong file):
//   • plan-edge-cases.ts — anchored, anchorDurationIs, choresListed, choresExclude, noSchemaVocabulary
//   • plan-rules.ts      — choresListed
//   • focusScaledDown    — used only here (no importers); plan-ongoing-sessions.ts has its own
//                          private `anchored` and imports nothing from this file.
//
// Clock pinned: every date derives from PLAN_NOW (a Tuesday) via dayOffsetISO(n, tz, PLAN_NOW) and
// every recurring lastDoneAt from instantOffsetISO(n, PLAN_NOW) — rot-free forever.

import { dayOffsetISO, DEFAULT_TZ, instantOffsetISO, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  bigRockNeverS,
  deadlinesCovered,
  planHeadline,
  rocksExclude,
  rocksResolve,
  smallRocksAtMost,
  smallRocksOnlySM,
} from '../../lib/checks.ts'
import type {
  PlanCheck,
  PlanResult,
  PlanScenario,
  PlanTaskRow,
  ScheduleConfig,
} from '../../lib/types.ts'

const D = (n: number) => dayOffsetISO(n, DEFAULT_TZ, PLAN_NOW)

function task(over: Partial<PlanTaskRow> & { id: string; text: string }): PlanTaskRow {
  return {
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    recurring: null,
    ongoing: false,
    start_date: null,
    ...over,
  }
}

// A weekday whose paid work ENDS AT LUNCH, so an early-afternoon appointment plainly lands in the
// user's own 4.5h rather than in work hours — otherwise "the commitment costs the day" is arguable
// (the model could reasonably say a 2 PM job overlaps work, not personal time) and the scale-down
// assertions below would be measuring the fixture, not the prompt. 4.5h is the app's own weekday
// default (plan-prompt.ts scheduleContext) — the figure the reported card echoed untouched.
const SHORT_WORKDAY: ScheduleConfig = {
  weekday: {
    wakeTime: '06:30',
    workStart: '07:00',
    workEnd: '12:30',
    lunchStart: '11:00',
    lunchEnd: '11:30',
    bedtime: '22:00',
    freeTimeEstimateHours: 4.5,
  },
}

// ---------- local checks (exported: plan-rules.ts / plan-edge-cases.ts compose these too) --------

type Emitted = NonNullable<PlanResult['bigRock']> | NonNullable<PlanResult['nudge']>
type Rock = NonNullable<PlanResult['bigRock']>

function rocks(plan: PlanResult): Rock[] {
  return [plan.bigRock, ...plan.smallRocks].filter((rock): rock is Rock => rock != null)
}

/** A task due today at a set clock time must land in the derived `anchors` strip. */
export function anchored(id: string, label: string): PlanCheck {
  return (plan) => {
    const anchor = (plan.anchors ?? []).find((a) => a.taskId === id)
    return {
      name: label,
      pass: anchor != null,
      detail: anchor ? `${anchor.time} — ${anchor.task}` : `anchors: ${plan.anchors?.length ?? 0}`,
    }
  }
}

/**
 * The anchor's `duration` — #345's new PlanAnchor field, stamped by deriveAnchors from the task's
 * own size (XL ⇒ "~half-day", M ⇒ "~45m") and `null` when the task is unsized. Pinned end-to-end
 * with the literal string the card renders, NOT by re-importing SIZE_HINTS (which would make the
 * assertion agree with itself no matter what the constant said).
 */
export function anchorDurationIs(id: string, expected: string | null, label: string): PlanCheck {
  return (plan) => {
    const anchor = (plan.anchors ?? []).find((a) => a.taskId === id)
    if (!anchor) return { name: label, pass: false, detail: 'task is not in the anchors strip' }
    return {
      name: label,
      pass: anchor.duration === expected,
      detail: `duration: ${anchor.duration === null ? 'null' : `"${anchor.duration}"`}`,
    }
  }
}

/** Every listed id reached the derived `chores` strip (deriveChores: overdue / never done / due today). */
export function choresListed(ids: string[], label: string): PlanCheck {
  return (plan) => {
    const strip = plan.chores ?? []
    const missing = ids.filter((id) => !strip.some((c) => c.taskId === id))
    return {
      name: label,
      pass: missing.length === 0,
      detail: `chores strip: ${strip.map((c) => `${c.task} (${c.status})`).join('; ') || 'empty'}`,
    }
  }
}

/**
 * The negative twin: none of these ids may reach the chores strip.
 *
 * This is a SELECTION pin, not a model check — a chore the cadence ladder calls 'ok' never enters
 * the request (buildPlanRequest drops `s.code === 'ok'`), so deriveChores cannot see it and the
 * model is never offered it. What it catches is the ladder's thresholds moving: widen 'ok' and a
 * chore the user did two days ago starts nagging them from the card again.
 */
export function choresExclude(ids: string[], label: string): PlanCheck {
  return (plan) => {
    const strip = plan.chores ?? []
    const leaked = ids.filter((id) => strip.some((c) => c.taskId === id))
    return {
      name: label,
      pass: leaked.length === 0,
      detail: `chores strip: ${strip.map((c) => `${c.task} (${c.status})`).join('; ') || 'empty'}`,
    }
  }
}

// The internal vocabulary plan-prompt.ts's "WRITE LIKE A PERSON, NOT LIKE THE SCHEMA" block forbids
// in anything the user reads. The reported headline — "…as a fixed anchor at 2pm" — is the reason
// that block exists. Schema field names are matched case-sensitively (camelCase is unmistakable);
// "ref" needs a word boundary or it fires on refill/refund/refactor.
const JARGON: Array<[string, RegExp]> = [
  ['anchor', /\banchor(s|ed|ing)?\b/i],
  ['big rock', /\bbig[-\s]rocks?\b/i],
  ['small rock', /\bsmall[-\s]rocks?\b/i],
  ['quick win', /\bquick[-\s]wins?\b/i],
  ['ref', /\brefs?\b/i],
  ['schema field', /\b(bigRock|smallRocks|habitNote|availableTime|emit_plan)\b/],
  // 2026-08-18: "T2 is 28 days overdue" — the bracketed line ids ([T2]/[R1]) are prompt
  // scaffolding too. Case-SENSITIVE on purpose (a lowercase "t2" in ordinary prose is not ours).
  // These checks run on the RESOLVED plan (runner → generatePlan → resolvePlanTaskIds), which now
  // scrubs resolvable tokens — so this asserts the prompt-mandated titles-in-prose invariant
  // end-to-end; only a token pointing at NO listed line could still surface here.
  ['task line id', /\b[TR]\d{1,3}\b/],
]

/**
 * No prompt scaffolding in USER-VISIBLE copy: headline, availableTime, habitNote, and every rock's
 * (and the nudge's) `why`. Rock `task` text is skipped — that is the user's own task title echoed
 * back, so a task literally named "anchor the tent" is not a leak.
 *
 * Returns TWO results on purpose. "slot" is on the prompt's banned list too, but it is also ordinary
 * English for a time window ("an open slot after lunch"), so it gets its own line: a failure there
 * is a real prompt violation, just a far more forgivable one than "as a fixed anchor at 2pm", and
 * keeping it separate stops it from masking the unambiguous leaks.
 */
export function noSchemaVocabulary(): PlanCheck {
  return (plan) => {
    const items = [plan.bigRock, ...plan.smallRocks, plan.nudge].filter(
      (i): i is Emitted => i != null,
    )
    const fields: Array<[string, string]> = [
      ['headline', plan.headline],
      ['availableTime', plan.availableTime],
      ['habitNote', plan.habitNote],
      ...items.map((i): [string, string] => [`why("${i.task}")`, i.why]),
    ]
    const hits: string[] = []
    for (const [term, re] of JARGON) {
      for (const [where, text] of fields) {
        if (text && re.test(text)) hits.push(`"${term}" in ${where}`)
      }
    }
    const slots = fields.filter(([, text]) => text && /\bslots?\b/i.test(text)).map(([w]) => w)
    return [
      {
        name: 'no prompt vocabulary in user-visible copy',
        pass: hits.length === 0,
        ...(hits.length ? { detail: hits.join('; ') } : {}),
      },
      {
        name: 'no "slot" in user-visible copy',
        pass: slots.length === 0,
        ...(slots.length ? { detail: `in ${slots.join(', ')}` } : {}),
      },
    ]
  }
}

/**
 * Rough hours from a model-written duration string ("~45min", "1.5h", "1–2 hours", "half-day").
 * Returns null when nothing numeric can be read, which the caller treats as "can't judge" rather
 * than as zero-length work. A range takes its LARGEST number (the honest cost of "1–2h" is 2).
 */
function parseHours(raw: string): number | null {
  const s = (raw ?? '').toLowerCase().replace(/[–—]/g, '-')
  if (/half[-\s]?day/.test(s)) return 4
  if (/(all|full)[-\s]?day/.test(s)) return 8
  // "half an hour" / "half hour" / "a half hour" — spelled out, so the numeric passes below find no
  // digit and the "an hour" fallback would score it as a FULL hour (double the real cost, which can
  // only ever produce a false FAIL). Read it first.
  if (/\bhalf\s+(an?\s+)?hour\b/.test(s)) return 0.5
  let hours: number | null = null
  // The number alternation accepts a bare-decimal (".5h" is half an hour) — without `|\.\d+` the
  // leading dot is skipped and ".5h" reads as FIVE hours.
  const h = [...s.matchAll(/(\d+(?:\.\d+)?|\.\d+)\s*(?:hours|hour|hrs|hr|h)(?![a-z])/g)]
  if (h.length) hours = Math.max(...h.map((m) => Number(m[1])))
  const min = [...s.matchAll(/(\d+(?:\.\d+)?|\.\d+)\s*(?:minutes|minute|mins|min|m)(?![a-z])/g)]
  if (min.length) {
    const asHours = Math.max(...min.map((m) => Number(m[1]))) / 60
    hours = hours == null ? asHours : hours + asHours
  }
  if (hours == null && /\b(an?|one)\s+hour\b/.test(s)) hours = 1
  return hours
}

/**
 * #345's core measurement: on a day a fixed commitment already owns, the work handed out must be
 * SCALED DOWN — read from the model's own `duration` strings, since the plan carries no free-hours
 * number the harness could compare against. plan-prompt.ts: "If they take most of the day, say so
 * plainly in availableTime and SCALE THE DAY DOWN: a much smaller focus, or bigRock null, is the
 * honest answer — never hand out a full session on top of a day that is already spoken for."
 * The reported card's 1.5h focus session is exactly what this fails.
 *
 * An unreadable duration counts as 0 toward the total (and is named in the detail) — better a
 * lenient pass than a scenario that fails on prose the check simply could not parse.
 *
 * `maxBigRockHours` is OPTIONAL and must be OMITTED on a board where no legitimate big rock exists
 * (everything substantial is an anchor, a chore, or a task the scenario separately forbids). There
 * the arm is a constant pass by construction, and stating a ceiling nothing can cross just dresses
 * a dead assertion up as a live one — the report should show only the arm that can actually fail.
 */
export function focusScaledDown(limits: {
  maxBigRockHours?: number
  maxTotalHours: number
}): PlanCheck {
  return (plan) => {
    const EPS = 0.01
    const all = rocks(plan)
    const big = plan.bigRock ? parseHours(plan.bigRock.duration) : null
    const total = all.reduce((sum, rock) => sum + (parseHours(rock.duration) ?? 0), 0)
    const unreadable = all
      .filter((rock) => parseHours(rock.duration) == null)
      .map((rock) => `"${rock.duration}"`)
    const bigOk =
      limits.maxBigRockHours == null || big == null || big <= limits.maxBigRockHours + EPS
    const pass = bigOk && total <= limits.maxTotalHours + EPS
    return {
      name:
        'day scaled down: ' +
        (limits.maxBigRockHours == null ? '' : `focus ≤${limits.maxBigRockHours}h, `) +
        `all work ≤${limits.maxTotalHours}h`,
      pass,
      detail:
        `${all.map((rock) => `${rock.task}: "${rock.duration}"`).join('; ') || 'no rocks'}` +
        ` → focus ${big ?? '—'}h, total ${Math.round(total * 100) / 100}h` +
        (unreadable.length ? ` (unparsed, counted as 0: ${unreadable.join(', ')})` : ''),
    }
  }
}

// ---------- scenarios ----------

export const scenarios: PlanScenario[] = [
  {
    kind: 'plan',
    id: 'panchor-halfday-anchor-vs-parked-project',
    title:
      'A half-day appointment eats the day: the focus scales down, the parked project stays parked',
    tags: ['plan', 'anchors', 'load', 'ongoing'],
    persona: 'the reported board: a 2 PM shop visit that the plan planned straight over',
    schedule: SHORT_WORKDAY,
    // ac1 is XL, so the anchors strip carries "~half-day" — the whole point of #345's new field.
    // ac2 is the ongoing project the user parked bottom-left (importance 20, urgency 15): the
    // caveat that used to fire only when EVERYTHING was low/low now judges it on its own standing,
    // and the two errands are exactly why the old form of the caveat never fired here.
    //
    // EXACTLY ONE errand is due TODAY. That is deliberate and load-bearing: with two, rule 1
    // ("every due-today task MUST appear") and rule 4 ("default to EXACTLY ONE quick win") pull
    // against each other on the one day the prompt is also shouting SCALE THE DAY DOWN, and the
    // plainly-correct scale-down answer — bigRock null plus a single quick win — hard-failed
    // deadlinesCovered. ac4 is due TOMORROW instead: still an errand the model may or may not pull
    // forward (both shapes are correct, and smallRocksAtMost(2) covers either), but it no longer
    // makes a second quick win mandatory. The subject of this scenario is that the appointment
    // COSTS TIME, not that two errands ship.
    tasks: [
      task({
        id: 'ac1',
        text: 'Timing belt replacement at the shop',
        x: 0.85,
        y: 0.6,
        size: 'XL',
        due: D(0),
        due_time: '14:00:00',
      }),
      task({ id: 'ac2', text: 'Restore the old canoe', x: 0.15, y: 0.2, size: 'L', ongoing: true }),
      task({ id: 'ac3', text: 'Pay the water bill', x: 0.8, y: 0.45, size: 'S', due: D(0) }),
      task({
        id: 'ac4',
        text: 'Text Marcus back about Saturday',
        x: 0.75,
        y: 0.4,
        size: 'S',
        due: D(1),
      }),
    ],
    habits: [{ text: 'Evening walk', active: true }],
    checks: [
      planHeadline(),
      anchored('ac1', 'the 2 PM shop visit is a fixed time'),
      anchorDurationIs('ac1', '~half-day', 'the strip carries the appointment’s cost'),
      // Vacuous-by-construction unless resolvePlanTaskIds regresses: it DROPS a rock that duplicates
      // an anchor. That drop is the pin — if it stops happening the appointment shows twice.
      rocksExclude(['ac1'], 'the appointment is not also handed out as work'),
      rocksExclude(['ac2'], 'the parked low/low project is not promoted into the empty focus slot'),
      // ac1 rides the anchors strip (that half is pinned by `anchored` above, and pins that the
      // strip COUNTS as appearing — the #344 contract). ac3 is the live half: the one due-today
      // errand must land somewhere, so a plan that spends its single quick win on tomorrow's ac4
      // and drops today's bill fails here.
      deadlinesCovered(['ac1', 'ac3']),
      smallRocksAtMost(2),
      // TOTAL-ONLY on purpose. There is no legitimate big rock on this board — ac1 is the anchor
      // (dropped by resolvePlanTaskIds), ac2 is the parked project the check above forbids, ac3/ac4
      // are S — so bigRock null is the honest answer and a focus ceiling could never be crossed.
      // The total is what the reported card actually broke: it handed out a 1.5h session on a day
      // already spoken for. 1.25h clears any honest combination of these errands (~0.25–0.5h) and
      // still fails that 1.5h. The focus-ceiling arm is exercised for real by the two scenarios
      // below, which do have a legitimate deliverable to trim.
      focusScaledDown({ maxTotalHours: 1.25 }),
      noSchemaVocabulary(),
      rocksResolve(),
    ],
    rubric:
      'A half-day job at the shop starts at 2 PM, against ~4.5h of personal time — so most of the ' +
      'day is already spoken for, and availableTime must say so honestly rather than repeat the ' +
      '4.5h figure untouched. The water bill is due today and belongs in the plan; the text to ' +
      'Marcus is due tomorrow, so pulling it forward is fine and leaving it for tomorrow is equally ' +
      'fine. The ongoing canoe project sits LOW on both importance and urgency: the user parked it, ' +
      'so an empty focus slot is not a reason to hand it a session (a no-pressure aside is fine; a ' +
      'scheduled block is not). Copy must read like a person — referring to "the 2 PM appointment" ' +
      'is good, reciting the strip’s times or calling it a "fixed anchor" is a fail.',
  },
  {
    kind: 'plan',
    id: 'panchor-unsized-anchor-judged-on-what-it-is',
    title: 'An UNSIZED fixed commitment carries no duration — its cost is the model’s own read',
    tags: ['plan', 'anchors', 'load'],
    persona: 'surgery at 1 PM, and a grant deadline two days out',
    schedule: SHORT_WORKDAY,
    // un1 has no size, so deriveAnchors stamps duration null — the prompt then says to judge the
    // cost "from what the thing actually is". An oral surgery is not a 15-minute errand, so the
    // 2h grant session (un2) has to shrink or wait.
    tasks: [
      task({
        id: 'un1',
        text: 'Wisdom tooth extraction at the oral surgeon',
        x: 0.8,
        y: 0.65,
        due: D(0),
        due_time: '13:00:00',
      }),
      task({
        id: 'un2',
        text: 'Finish the grant narrative draft',
        x: 0.6,
        y: 0.9,
        size: 'L',
        due: D(2),
      }),
      task({
        id: 'un3',
        text: 'Email the pharmacy about the prescription',
        x: 0.75,
        y: 0.5,
        size: 'S',
        due: D(0),
      }),
    ],
    habits: [{ text: 'Drink more water', active: true }],
    checks: [
      planHeadline(),
      anchored('un1', 'the 1 PM surgery is a fixed time'),
      anchorDurationIs('un1', null, 'an unsized commitment carries no duration'),
      rocksExclude(['un1'], 'the surgery is not also handed out as work'),
      deadlinesCovered(['un1', 'un3']),
      smallRocksAtMost(2),
      // The line the prompt actually draws is at the FULL session: "never hand out a full session
      // on top of a day that is already spoken for" (plan-prompt.ts FIXED TIMES block), and the
      // rubric below says the same ("a full 2h session today is dishonest"). un2 is L, whose own
      // rendered hint is ~2h — so anything at or above 2h fails and a genuinely trimmed session
      // passes. A tighter ceiling would reject "~1.25h"/"~1.5h", which the prompt permits.
      focusScaledDown({ maxBigRockHours: 1.5, maxTotalHours: 2 }),
      noSchemaVocabulary(),
      rocksResolve(),
    ],
    rubric:
      'A wisdom-tooth extraction is booked for 1 PM and carries no stated length — the plan has to ' +
      'judge the cost from what it plainly is (a procedure plus recovery, not a quick errand) and ' +
      'size the day down accordingly. The grant draft is a real deadline two days out, but a full ' +
      '2h session today is dishonest; a much smaller piece of it, or leaving it for tomorrow with ' +
      'that said plainly, are both good answers. The due-today pharmacy email is small and belongs ' +
      'in the plan. Copy must read like a person: referring to the 1 PM appointment naturally where ' +
      'it shapes the day is good (the plan is explicitly allowed to do that), while reciting the ' +
      'strip’s times back as an announcement, or calling it a "fixed anchor", is a fail.',
  },
  {
    kind: 'plan',
    id: 'panchor-anchor-not-squeezed-by-due-today-crowd',
    title: 'An anchor plus two due-today errands: the timed item still reaches the card',
    tags: ['plan', 'anchors', 'deadlines'],
    persona: '#344 with the board that actually reproduced the squeeze',
    schedule: SHORT_WORKDAY,
    // The pre-#344 failure needs THREE due-today items: the timed one (barred from the big rock)
    // plus two more that fill smallRocks (capped at 2) — then the timed one had nowhere left to go.
    // t4 is the tempting undated project. It is sized L, not M, on purpose: as an M it made
    // smallRocksOnlySM a constant pass (no L/XL existed anywhere on the board), and as an L that
    // check finally bites — rule 4 says a long task is NEVER a quick win, so filing the garage
    // project as a quick win now fails. Its legitimate home is the leftover big-rock slot.
    tasks: [
      task({
        id: 't1',
        text: 'Call with the insurance adjuster',
        x: 0.8,
        y: 0.7,
        size: 'M',
        due: D(0),
        due_time: '14:00:00',
      }),
      task({
        id: 't2',
        text: 'Drop the rent check at the office',
        x: 0.85,
        y: 0.5,
        size: 'S',
        due: D(0),
      }),
      task({
        id: 't3',
        text: 'Send the signed permission slip',
        x: 0.8,
        y: 0.45,
        size: 'S',
        due: D(0),
      }),
      task({ id: 't4', text: 'Sort out the garage shelving', x: 0.45, y: 0.8, size: 'L' }),
    ],
    checks: [
      planHeadline(),
      anchored('t1', 'the 2 PM call is a fixed time'),
      rocksExclude(['t1'], 'the call is not also handed out as work'),
      deadlinesCovered(['t1', 't2', 't3']),
      // Rule 3, and the one violation this board can produce that nothing else here would see: with
      // the only M gone to the anchors strip, promoting an S errand to the day's focus passes every
      // other check on the list. It replaces a noFarDatedOverDue(['t2','t3'], ['t4']) that could
      // never fail on its own — it scans the same surfaces as deadlinesCovered(['t1','t2','t3']),
      // so "something due-now is unplanned" was already a deadlinesCovered failure.
      bigRockNeverS(),
      smallRocksOnlySM(),
      smallRocksAtMost(2),
      noSchemaVocabulary(),
      rocksResolve(),
    ],
    rubric:
      'Three things are due today — a 2 PM call plus two small errands — and one undated project ' +
      'is sitting there looking interesting. The call happens at its time whether or not the plan ' +
      'says so, and both errands are due today, so all three must reach the card. The garage ' +
      'project is the only substantial thing here and may take the focus once the deadlines are ' +
      'covered, but never a quick-win slot. Referring to the call naturally is good; reciting ' +
      'its time back, or calling it an "anchor", is a fail.',
  },
  {
    kind: 'plan',
    id: 'panchor-anchor-plus-due-chores-scale-the-day',
    title:
      'Both derived strips at once: a timed commitment, two due chores, and one real deliverable',
    tags: ['plan', 'anchors', 'recurring', 'load'],
    persona: '#344 × #351 — a day where the card fills itself before the model picks anything',
    schedule: SHORT_WORKDAY,
    // an1 (L ⇒ "~2h") lands in the anchors strip; ch1/ch2 land in the chores strip (never done
    // sorts first: daysLeft -999). Neither strip may cost a rock slot — so if the model spends its
    // quick wins on the chores, resolvePlanTaskIds drops them and dl1 silently disappears from the
    // card. lo1 is the parked low/low ongoing project that must not fill the leftover focus slot.
    tasks: [
      task({
        id: 'an1',
        text: 'Deposition at the lawyer’s office',
        x: 0.85,
        y: 0.75,
        size: 'L',
        due: D(0),
        due_time: '13:00:00',
      }),
      task({
        id: 'ch1',
        text: 'Change the furnace filter',
        recurring: { frequencyDays: 30, lastDoneAt: null, doneCount: 0 },
      }),
      task({
        id: 'ch2',
        text: 'Take the bins out',
        recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-9, PLAN_NOW), doneCount: 12 },
      }),
      task({
        id: 'dl1',
        text: 'Send the contractor the signed estimate',
        x: 0.8,
        y: 0.7,
        size: 'M',
        due: D(0),
      }),
      task({
        id: 'lo1',
        text: 'Digitize the old cassettes',
        x: 0.15,
        y: 0.2,
        size: 'M',
        ongoing: true,
      }),
    ],
    habits: [{ text: 'Stretch for ten minutes', active: true }],
    checks: [
      planHeadline(),
      anchored('an1', 'the 1 PM deposition is a fixed time'),
      anchorDurationIs('an1', '~2h', 'the strip carries the deposition’s cost'),
      choresListed(['ch1', 'ch2'], 'both due-now chores reach the chores strip'),
      deadlinesCovered(['an1', 'ch1', 'ch2', 'dl1']),
      rocksExclude(['an1', 'ch1', 'ch2'], 'nothing the card lists itself is also a rock'),
      rocksExclude(['lo1'], 'the parked low/low project is not promoted'),
      smallRocksAtMost(2),
      focusScaledDown({ maxBigRockHours: 1.5, maxTotalHours: 2.5 }),
      noSchemaVocabulary(),
      rocksResolve(),
    ],
    rubric:
      'The card already fills itself twice over today: a ~2h deposition at 1 PM, and two chores the ' +
      'user’s own cadence says happen today (one never done, one two days past its cadence). It must not ' +
      're-list any of them as work — but it also must not let the one real deliverable, the signed ' +
      'estimate due today, fall off the card. With a 2h commitment inside ~4.5h of personal time, ' +
      'the day it plans on top should be modest and said honestly. The cassette-digitizing project ' +
      'sits low on both axes — the user parked it, so it does not get today’s focus by default.',
  },
]
