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
import type { PlanScenario, PlanTaskRow } from '../../lib/types.ts'

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
      rocksResolve(),
    ],
    rubric:
      'The big rock should be one of the substantive tasks (the due-soon L report is the natural ' +
      'pick over the undated XL refactor). Quick wins should be genuinely small. The habit gets a ' +
      'nod in habitNote. No task is invented.',
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
    // hold either way; the rubric judges the softer "didn't manufacture a mandatory big rock" quality.
    tasks: [
      task({ id: 'lv1', text: 'Sort through old photos', x: 0.2, y: 0.25, size: 'S' }),
      task({ id: 'lv2', text: 'Reorganize the bookshelf', x: 0.15, y: 0.2, size: 'M' }),
      task({ id: 'lv3', text: 'Practice guitar', x: 0.2, y: 0.3, size: 'M', ongoing: true }),
    ],
    habits: [{ text: 'Drink more water', active: true }],
    checks: [planHeadline(), rocksResolve(), bigRockNeverS(), nudgeContract()],
    rubric:
      'The board holds only minor, non-urgent, undated tasks. The plan must NOT manufacture a ' +
      'mandatory-feeling big rock out of one of them (the ongoing "Practice guitar" included). A ' +
      'relaxed day is a perfectly good outcome: if it rests, the framing is calm and any nudge is a ' +
      'no-pressure "if you want something to do" suggestion, not an assignment. If it instead names ' +
      'a single light focus, that is also fine. No task is invented.',
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
    rubric:
      'The dentist appointment is on a fixed future day — the plan must not schedule it today ' +
      'or tell the user to do it early. The expense report (due today) is the natural focus.',
  },
  {
    kind: 'plan',
    id: 'plan-recurring-chore',
    title: 'An overdue recurring chore surfaces as a rock or explicit mention',
    tags: ['plan', 'recurring'],
    tasks: [
      task({
        id: 'r1',
        text: 'Water the plants',
        recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-10, PLAN_NOW), doneCount: 4 },
      }),
      task({ id: 'r2', text: 'Draft blog post', x: 0.5, y: 0.7, size: 'M' }),
    ],
    checks: [planHeadline(), rocksResolve()],
    rubric:
      'The plants chore is 3 days overdue — the plan should surface it (as a quick win or a ' +
      'clear mention), not silently drop it.',
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
      'One task is due today and another is 2 days overdue. Both must be in the plan. An undated ' +
      'ongoing project or a task due in 3-6 days must not take a slot while either is unplanned — ' +
      'substance ranks the candidates that deadlines already let in, it does not outrank a deadline.',
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
      'Laundry is due today. It must appear on the card — in the chores strip is correct and ' +
      'expected; what must never happen is it vanishing while undated work fills the plan.',
  },
]
