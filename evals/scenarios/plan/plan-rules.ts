// plan-rules.ts — the planner's hard rules, machine-checked end-to-end: fixture rows go through
// the REAL buildPlanRequest selection, the REAL prompt, the prod model, and the emitted rocks are
// resolved back to fixture ids — so "an S task must never be the big rock" is a lookup, not a vibe.
//
// Plan fixtures pin the clock: every date derives from PLAN_NOW (a Tuesday) via
// dayOffsetISO(n, tz, PLAN_NOW) — rot-free forever.

import { dayOffsetISO, DEFAULT_TZ, instantOffsetISO, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  bigRockNeverS,
  deadlinesCovered,
  noFarDatedOverDue,
  nudgeContract,
  planHeadline,
  restDay,
  rocksExclude,
  rocksResolve,
  smallRocksAtMost,
  smallRocksOnlySM,
} from '../../lib/checks.ts'
// choresListed lives with the family that introduced it (#345's anchor/chore work) — evals/lib is
// shared ground that per-family authors don't edit.
import { choresListed } from './plan-anchors-and-load.ts'
import type { PlanCheck, PlanScenario, PlanTaskRow } from '../../lib/types.ts'

const D = (n: number) => dayOffsetISO(n, DEFAULT_TZ, PLAN_NOW)

/**
 * The chores strip carries the cadence ladder's own LABEL, not just the task text.
 *
 * `choresListed` asserts membership only — and `deriveChores` selects on `daysLeft <= 0`, so an
 * overdue chore and a due-today chore are indistinguishable once they are in the strip. Without
 * this, plan-recurring-chore measured exactly what pedge-recurring-due-vs-recent already measures
 * and the "OVERDUE" in its own title was pinned by nothing. Pinned against the literal string the
 * card renders rather than by re-deriving it from recurring-status.ts, which would make the
 * assertion agree with itself no matter what the ladder said (same doctrine as anchorDurationIs).
 */
function choreStatusIs(id: string, expected: string, label: string): PlanCheck {
  return (plan) => {
    const chore = (plan.chores ?? []).find((c) => c.taskId === id)
    if (!chore) return { name: label, pass: false, detail: 'task is not in the chores strip' }
    return { name: label, pass: chore.status === expected, detail: `status: "${chore.status}"` }
  }
}

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

export const scenarios: PlanScenario[] = [
  {
    kind: 'plan',
    id: 'plan-size-rules',
    title: 'Big rock is substantive (never S); quick wins are small (never L/XL); ≤2 quick wins',
    tags: ['plan', 'sizes', 'rules'],
    persona: 'busy mixed-load day',
    tasks: [
      task({ id: 'p1', text: 'Write the quarterly report', x: 0.7, y: 0.9, size: 'L', due: D(2) }),
      task({ id: 'p2', text: 'Email the plumber back', x: 0.8, y: 0.4, size: 'S', due: D(0) }),
      task({ id: 'p3', text: 'Order printer ink', x: 0.6, y: 0.3, size: 'S' }),
      task({ id: 'p4', text: 'Refactor the billing module', x: 0.4, y: 0.8, size: 'XL' }),
      task({ id: 'p5', text: 'Book dentist appointment', x: 0.5, y: 0.5, size: 'S', due: D(3) }),
      task({ id: 'p6', text: 'Prep slides for team sync', x: 0.65, y: 0.7, size: 'M', due: D(1) }),
    ],
    habits: [{ text: 'Morning run', active: true }],
    checks: [
      planHeadline(),
      bigRockNeverS(),
      smallRocksOnlySM(),
      smallRocksAtMost(2),
      // Sizes alone were satisfiable by a plan that never mentioned p2 — the S task due TODAY —
      // while the undated ink order took a quick-win slot. Rule 1 forbids exactly that, so the
      // size rules are now measured on a plan that also has to cover its deadline.
      deadlinesCovered(['p2']),
      noFarDatedOverDue(['p2'], ['p3', 'p4']),
      rocksResolve(),
    ],
    rubric:
      'A mixed-size board: an L report due in 2 days, an S plumber email due today, an M slide ' +
      'prep due tomorrow, plus undated distractors; one active habit (Morning run). Sizes and ' +
      'deadline coverage are machine-checked. FAIL if: habitNote does not acknowledge the Morning ' +
      'run habit; the prose invents a task, deadline, or detail not in the fixture.',
  },
  {
    kind: 'plan',
    id: 'plan-rest-day',
    title: 'An empty board yields a rest day — no invented work',
    tags: ['plan', 'rest-day', 'faithfulness'],
    persona: 'brand-new user',
    tasks: [],
    habits: [{ text: 'Drink more water', active: true }],
    // A truly empty board has nothing to point at → a pure rest day, and never a nudge.
    checks: [planHeadline(), restDay(), nudgeContract()],
  },
  {
    kind: 'plan',
    id: 'plan-low-value-board',
    title: 'A low-value board is not padded — a big rock is never manufactured from a minor task',
    tags: ['plan', 'rest-day', 'nudge', 'faithfulness'],
    persona: 'nearly-cleared board, nothing pressing',
    // Only a few LOW-importance, LOW-urgency, undated tasks — one an ongoing project. Nothing here
    // earns a substantial focused block, so the model must NOT inflate one into the big rock. Either
    // outcome is valid (it's a non-deterministic call): a relaxed day (bigRock null) — optionally
    // with a no-pressure nudge — or a single light focus. The checks pin only the invariants that
    // hold either way; the rubric fails only false urgency, assignment-framed nudges, and
    // mandatory-big-rock framing (nothing on this board is due, so claimed pressure is invention).
    tasks: [
      task({ id: 'lv1', text: 'Sort through old photos', x: 0.2, y: 0.25, size: 'S' }),
      task({ id: 'lv2', text: 'Reorganize the bookshelf', x: 0.15, y: 0.2, size: 'M' }),
      task({ id: 'lv3', text: 'Practice guitar', x: 0.2, y: 0.3, size: 'M', ongoing: true }),
    ],
    habits: [{ text: 'Drink more water', active: true }],
    checks: [planHeadline(), rocksResolve(), bigRockNeverS(), nudgeContract()],
    rubric:
      'The board holds only three minor, undated, low-importance/low-urgency tasks (one an ' +
      'ongoing guitar project); a relaxed day, a nudge, or a single light focus are all valid ' +
      'shapes. FAIL if: the plan claims something is due, urgent, or pressing (nothing is); a ' +
      'nudge is framed as an assignment or instruction rather than a no-pressure option; a big ' +
      'rock is framed as mandatory ("you must/need to do this today"); the prose invents a task ' +
      'or deadline.',
  },
  {
    kind: 'plan',
    id: 'plan-dormant-excluded',
    title: 'A paused (future start_date) task never becomes a rock, however important it looks',
    tags: ['plan', 'pause', 'dormancy'],
    tasks: [
      task({
        id: 'd1',
        text: 'Launch the newsletter',
        x: 0.9,
        y: 0.95,
        size: 'L',
        start_date: D(5),
      }),
      task({ id: 'd2', text: 'Tidy the desk', x: 0.4, y: 0.35, size: 'S' }),
    ],
    checks: [rocksExclude(['d1'], 'paused task never scheduled'), rocksResolve()],
  },
  {
    kind: 'plan',
    id: 'plan-appointment-rule',
    title: 'A fixed-day appointment is not "knocked out early"',
    tags: ['plan', 'appointments', 'rules'],
    tasks: [
      task({
        id: 'a1',
        text: 'Dentist appointment',
        x: 0.6,
        y: 0.6,
        size: 'S',
        due: D(3),
        due_time: '15:30:00',
      }),
      task({ id: 'a2', text: 'Finish expense report', x: 0.7, y: 0.6, size: 'M', due: D(0) }),
    ],
    checks: [rocksExclude(['a1'], 'future appointment left out of today'), rocksResolve()],
    // No deadlinesCovered here, so the rubric is the only detector for a2 (due today) going
    // missing; the "do it early" prose ban and the invented-prep ban are prompt mandates that only
    // the judge can see (rocksExclude catches an emitted rock, not a prose suggestion).
    rubric:
      'A dentist appointment sits on a fixed day 3 days out; an expense report is due today. FAIL ' +
      'if: the plan tells the user to do, knock out, finish, or get ahead on the dentist ' +
      'appointment before its day; the due-today expense report is absent from the plan; the ' +
      'prose invents prep work or tasks not on the board.',
  },
  {
    kind: 'plan',
    id: 'plan-recurring-chore',
    title: 'An OVERDUE recurring chore rides the chores strip — and is never also a quick win',
    tags: ['plan', 'recurring'],
    // Rewritten for the shipped contract: a chore the cadence wants today (here: overdue 3d) is
    // DERIVED onto the card by deriveChores, and rule 4 now says "Do NOT spend a slot on a
    // recurring chore that is due today — the app lists those itself". The old rubric rewarded
    // emitting it as a quick win, which resolvePlanTaskIds would then silently drop.
    tasks: [
      task({
        id: 'r1',
        text: 'Water the plants',
        recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-10, PLAN_NOW), doneCount: 4 },
      }),
      task({ id: 'r2', text: 'Draft blog post', x: 0.5, y: 0.7, size: 'M' }),
    ],
    checks: [
      planHeadline(),
      choresListed(['r1'], 'the overdue chore reaches the chores strip'),
      // lastDoneAt is PLAN_NOW − 10d on a 7-day cadence ⇒ daysLeft −3 ⇒ 'overdue 3d'
      // (recurring-status.ts statusFromDaysLeft). The one thing in this scenario that
      // pedge-recurring-due-vs-recent (daysLeft 0, 'due today') does not already cover.
      choreStatusIs('r1', 'overdue 3d', 'the strip carries the ladder’s overdue label'),
      // Subsumed by choresListed above (the strip is one of the surfaces deadlinesCovered scans),
      // kept so the report names rule 1 explicitly on a chore-only board.
      deadlinesCovered(['r1']),
      rocksExclude(['r1'], 'the chore is not also handed out as a rock'),
      rocksResolve(),
    ],
    rubric:
      'A weekly plants chore is 3 days overdue (the card’s own chores strip lists it; a rock ' +
      'duplicating it is dropped before judging); an undated M blog post is the only grid task. ' +
      'FAIL if: the prose contradicts the overdue chore (e.g. claims nothing is due or overdue ' +
      'today); the user is scolded or guilt-tripped over the overdue chore; a task is invented.',
  },
  {
    kind: 'plan',
    id: 'plan-deadlines-beat-substance',
    title: 'Due-today/overdue work gets the slots before undated or far-dated work',
    tags: ['plan', 'deadlines', 'rules'],
    persona: 'the reported failure: a juicy ongoing project crowded out what was actually due',
    // Modelled on the real board that produced it — the planner made the undated ongoing project
    // the big rock, spent both quick-win slots on tasks due in 3 and 6 days, and dropped the chore
    // due TODAY. Rule 1 already said due-soon work must appear; nothing measured it.
    tasks: [
      task({ id: 'd1', text: 'Send the signed lease back', x: 0.8, y: 0.7, size: 'M', due: D(0) }),
      task({ id: 'd2', text: 'Pay the parking ticket', x: 0.9, y: 0.5, size: 'S', due: D(-2) }),
      // The distractors: high-importance, but nothing is due.
      task({ id: 'f1', text: 'Work on TodoClaw', x: 0.8, y: 0.95, size: 'XL', ongoing: true }),
      task({
        id: 'f2',
        text: 'Email the marathon for a refund',
        x: 0.6,
        y: 0.6,
        size: 'S',
        due: D(3),
      }),
      task({
        id: 'f3',
        text: 'Research mountaineering gear',
        x: 0.5,
        y: 0.7,
        size: 'M',
        due: D(6),
      }),
    ],
    habits: [{ text: 'Drink more water', active: true }],
    checks: [
      planHeadline(),
      deadlinesCovered(['d1', 'd2']),
      noFarDatedOverDue(['d1', 'd2'], ['f1', 'f2', 'f3']),
      rocksResolve(),
    ],
    rubric:
      'One task is due today and one is 2 days overdue, against an undated ongoing project and ' +
      'two far-dated tasks; coverage and precedence are machine-checked. FAIL if: the prose ' +
      'scolds or guilt-trips over the overdue parking ticket; the prose contradicts the deadlines ' +
      '(claims nothing is due, or presents the far-dated items as urgent); a task or date is ' +
      'invented.',
  },
  {
    kind: 'plan',
    id: 'plan-due-chore-not-dropped',
    title: 'A recurring chore due today survives a board full of tempting undated work',
    tags: ['plan', 'recurring', 'deadlines'],
    // The exact reported case: weekly laundry due today, against work with no deadline at all.
    // The chore reaches the card via the derived chores strip, so it cannot lose a rock slot.
    tasks: [
      task({
        id: 'c1',
        text: 'Laundry',
        recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-7, PLAN_NOW), doneCount: 9 },
      }),
      task({ id: 'f1', text: 'Work on TodoClaw', x: 0.8, y: 0.95, size: 'XL', ongoing: true }),
      task({
        id: 'f2',
        text: 'Research mountaineering gear',
        x: 0.5,
        y: 0.7,
        size: 'M',
        due: D(6),
      }),
    ],
    checks: [planHeadline(), deadlinesCovered(['c1']), rocksResolve()],
    rubric:
      'Weekly laundry is due today and reaches the card via the derived chores strip ' +
      '(machine-checked); the rest of the board is undated or dated days out. FAIL if: the prose ' +
      'denies or contradicts that laundry is due today; a task or deadline is invented.',
  },
]
