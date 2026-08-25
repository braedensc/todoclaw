// plan-edge-cases.ts — boundary conditions for the planner: all-due-today crunch, habit-only
// boards, deep-overdue focus, fixed-time anchors, near-duplicate texts, recurring due-vs-recent,
// soon-to-wake paused tasks, and funky task text. Clock pinned: every date derives from PLAN_NOW
// (a Tuesday) via dayOffsetISO — rot-free forever.

import { dayOffsetISO, DEFAULT_TZ, instantOffsetISO, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  bigRockNeverS,
  deadlinesCovered,
  planHeadline,
  restDay,
  rocksExclude,
  rocksResolve,
  smallRocksAtMost,
  smallRocksOnlySM,
} from '../../lib/checks.ts'
// The #345 anchor/chore combinators live with the family that introduced them (evals/lib is shared
// ground that per-family authors don't edit); `anchored` moved there too rather than exist twice.
import {
  anchored,
  anchorDurationIs,
  choresExclude,
  choresListed,
  noSchemaVocabulary,
} from './plan-anchors-and-load.ts'
import type { PlanCheck, PlanResult, PlanScenario, PlanTaskRow } from '../../lib/types.ts'

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

// ---------- local custom checks ----------

type Rock = NonNullable<PlanResult['bigRock']>
function allRocks(plan: PlanResult): Rock[] {
  return [plan.bigRock, ...plan.smallRocks].filter((rock): rock is Rock => rock != null)
}

function habitNoteEngages(): PlanCheck {
  return (plan) => ({ name: 'habitNote non-empty', pass: plan.habitNote.trim().length > 0 })
}

function bigRockIs(id: string, label: string): PlanCheck {
  return (plan) => {
    const pass = plan.bigRock?.taskId === id
    return {
      name: label,
      pass,
      ...(pass
        ? {}
        : {
            detail: `bigRock: ${plan.bigRock?.task ?? 'null'} (taskId=${
              plan.bigRock?.taskId ?? 'null'
            })`,
          }),
    }
  }
}

function rockScheduled(id: string, label: string): PlanCheck {
  return (plan) => {
    const ids = allRocks(plan).map((rock) => rock.taskId)
    const pass = ids.includes(id)
    return {
      name: label,
      pass,
      ...(pass ? {} : { detail: `rock taskIds: ${ids.map(String).join(', ') || 'none'}` }),
    }
  }
}

function rockTaskIdsDistinct(): PlanCheck {
  return (plan) => {
    const ids = allRocks(plan)
      .map((rock) => rock.taskId)
      .filter((id): id is string => id != null)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    return {
      name: 'no two rocks share a task id',
      pass: dupes.length === 0,
      ...(dupes.length ? { detail: `duplicated: ${dupes.join(', ')}` } : {}),
    }
  }
}

/** Rocks resolving to these ids must carry the matching distinguishing word in their emitted
 * text — catches ref resolution crossing wires between near-duplicate task texts. */
function rockTextMatchesId(pairs: Record<string, string>, label: string): PlanCheck {
  return (plan) => {
    const bad = allRocks(plan).filter((rock) => {
      const want = rock.taskId ? pairs[rock.taskId] : undefined
      return want != null && !rock.task.toLowerCase().includes(want.toLowerCase())
    })
    return {
      name: label,
      pass: bad.length === 0,
      ...(bad.length
        ? { detail: bad.map((rock) => `"${rock.task}" → ${rock.taskId}`).join('; ') }
        : {}),
    }
  }
}

// There is deliberately NO slot-window check here any more. pedge-timed-anchor used to assert that
// its flexible task landed in `afternoon` or `evening`, but a plan scenario only gets a SCHEDULE &
// AVAILABILITY block when it supplies a `schedule` (plan-prompt.ts scheduleContext: `if (!schedule)
// return ''`) — and that block is the ONLY place morning/lunch/afternoon/evening are given any
// meaning. Without it the model picks a `when` out of four bare enum values, so "draft the release
// notes in the morning, then you're clear for the 3 PM demo" — a plainly correct plan — hard-failed.
// Adding a schedule does not rescue it either: no named window contains a single 3 PM point in a way
// that makes one slot unambiguously a collision and another unambiguously safe. The intent (flexible
// work fits AROUND the fixed time) now lives in that scenario's rubric, where a judgment call
// belongs. Re-add a deterministic slot check only if the prompt ever gains real slot boundaries.

/** Substring probe over the WHOLE emitted plan (headline, availableTime, rocks, habitNote). */
function planNotMentions(needle: string, label: string): PlanCheck {
  return (plan) => ({
    name: label,
    pass: !JSON.stringify(plan).toLowerCase().includes(needle.toLowerCase()),
  })
}

// ---------- shared fixtures ----------

// Soon-to-wake paused task (starts in 2 days = Thursday) + a mundane active companion so the day
// isn't a rest day. Used by both the exclusion scenario and its judged heads-up twin below.
const KILN_TASKS: PlanTaskRow[] = [
  task({
    id: 'u1',
    text: 'Finalize kiln firing schedule',
    x: 0.85,
    y: 0.95,
    size: 'L',
    start_date: D(2),
  }),
  task({ id: 'u2', text: 'Sweep the studio floor', x: 0.45, y: 0.35, size: 'S' }),
]

// ---------- scenarios ----------

export const scenarios: PlanScenario[] = [
  {
    kind: 'plan',
    id: 'pedge-crunch-day',
    title: 'Five tasks all due today: calm triage, no cramming',
    tags: ['plan', 'edge', 'crunch', 'triage'],
    persona: 'overloaded deadline day',
    tasks: [
      task({ id: 'c1', text: 'File the visa application', x: 0.8, y: 0.9, size: 'L', due: D(0) }),
      task({
        id: 'c2',
        text: 'Reply to the landlord about the lease',
        x: 0.85,
        y: 0.5,
        size: 'S',
        due: D(0),
      }),
      task({
        id: 'c3',
        text: 'Prep notes for the parent-teacher call',
        x: 0.7,
        y: 0.7,
        size: 'M',
        due: D(0),
      }),
      task({ id: 'c4', text: 'Pick up the birthday cake', x: 0.9, y: 0.4, size: 'S', due: D(0) }),
      task({ id: 'c5', text: "Review Dana's grant draft", x: 0.6, y: 0.8, size: 'M', due: D(0) }),
    ],
    checks: [
      planHeadline(),
      bigRockNeverS(),
      smallRocksOnlySM(),
      smallRocksAtMost(2),
      rocksResolve(),
      // The failure that motivated the due-today strip: the rock caps are RIGHT (one focus, one or
      // two quick wins), so on this board the plan named three of the five and the other two were
      // nowhere on the card at all. The strip is the card's answer, and this is the check on it —
      // all five must reach the user, as a rock or in the strip.
      deadlinesCovered(['c1', 'c2', 'c3', 'c4', 'c5']),
    ],
    // Note the rubric no longer asks the model to say how MANY are due: the strip shows the real
    // list beside the prose, and a recited count can only contradict what the user is looking at
    // (a cheaper model said "four items due" on this exact board when five were). The prompt bans
    // the count outright, so the judge would be scoring a behavior the prompt forbids.
    rubric:
      'Five tasks are all due today; rock counts, sizes and full deadline coverage are ' +
      'machine-checked. FAIL if: the prose promises or implies all five will get done today, or ' +
      'fails to acknowledge that more is due than fits; the user is scolded or guilt-tripped; a ' +
      'task is invented.',
  },
  {
    kind: 'plan',
    id: 'pedge-habits-only',
    title: 'Only habits, no tasks: rest day with an engaged habitNote',
    tags: ['plan', 'edge', 'habits', 'rest-day'],
    persona: 'habits-first user',
    tasks: [],
    habits: [
      { text: 'Stretch for ten minutes', active: true },
      { text: 'Evening walk', active: true },
    ],
    checks: [planHeadline(), restDay(), habitNoteEngages()],
    rubric:
      'No tasks at all, two active habits; the no-rocks rest day is machine-checked. FAIL if: ' +
      'the prose invents or assigns work that is not on the board; habitNote does not actually ' +
      'acknowledge the habits (a line unrelated to the stretching or the evening walk).',
  },
  {
    kind: 'plan',
    id: 'pedge-overdue-focus',
    title: 'A single task 5 days overdue is the unambiguous focus',
    tags: ['plan', 'edge', 'overdue'],
    tasks: [
      task({
        id: 'o1',
        text: 'Renew the car registration',
        x: 0.75,
        y: 0.6,
        size: 'M',
        due: D(-5),
      }),
    ],
    checks: [planHeadline(), bigRockIs('o1', 'overdue task is the big rock'), rocksResolve()],
    rubric:
      'A single task, 5 days overdue; its big-rock status is machine-checked. FAIL if: the user ' +
      'is scolded or guilt-tripped over the task being overdue; a task or date is invented.',
  },
  {
    kind: 'plan',
    id: 'pedge-timed-anchor',
    title: 'Due today at 15:00 is a fixed afternoon anchor; untimed work flexes around it',
    tags: ['plan', 'edge', 'due-time', 'anchors'],
    tasks: [
      task({
        id: 't1',
        text: 'Present the demo to the Harlow team',
        x: 0.8,
        y: 0.8,
        size: 'M',
        due: D(0),
        due_time: '15:00:00',
      }),
      task({ id: 't2', text: 'Draft the release notes', x: 0.7, y: 0.65, size: 'M', due: D(0) }),
    ],
    checks: [
      planHeadline(),
      rocksResolve(),
      // The demo is a fixed time, so it belongs in the anchors strip and NOT in a rock slot —
      // the rock caps used to be the only home for it, which is how a timed commitment could get
      // squeezed off the card entirely by a couple of due-today errands.
      anchored('t1', 'timed demo is a fixed-time anchor'),
      // #345 gave PlanAnchor a duration from the task's own size — t1 is M, so the strip says ~45m.
      anchorDurationIs('t1', '~45m', 'the strip carries the demo’s rough cost'),
      rocksExclude(['t1'], 'the anchor is not also emitted as a rock'),
      deadlinesCovered(['t1', 't2']),
      // #345: the reported headline read "…as a fixed anchor at 2pm" — scaffolding, verbatim.
      noSchemaVocabulary(),
    ],
    // No `schedule`, so the prompt carries no SCHEDULE & AVAILABILITY block and the four `when`
    // values are unlabeled to the model — which is why "the release notes go in a window clear of
    // 3 PM" is a rubric line here and not a deterministic check (see the note above planNotMentions).
    rubric:
      'A demo is fixed at 3 PM today (the anchors strip is machine-checked); the release notes ' +
      'are due today, untimed; there is no schedule block, so slot names carry no defined ' +
      'windows. FAIL if: the plan suggests doing the demo earlier or at a different time than ' +
      '3 PM; the release notes are presented so the two would read as happening at once; the ' +
      'demo’s time is recited back as an announcement rather than referred to naturally (a ' +
      'reference like "after the 3 PM demo" is NOT a failure); a task is invented.',
  },
  {
    kind: 'plan',
    id: 'pedge-twin-texts',
    title: 'Near-duplicate task texts resolve to distinct ids without crossing wires',
    tags: ['plan', 'edge', 'resolution'],
    tasks: [
      task({ id: 'e1', text: 'Email Sam re contract', x: 0.8, y: 0.55, size: 'S', due: D(0) }),
      task({ id: 'e2', text: 'Email Sam re invoice', x: 0.75, y: 0.5, size: 'S', due: D(0) }),
      task({
        id: 'e3',
        text: 'Outline the workshop agenda',
        x: 0.55,
        y: 0.85,
        size: 'L',
        due: D(1),
      }),
    ],
    checks: [
      rocksResolve(),
      rockTaskIdsDistinct(),
      rockTextMatchesId({ e1: 'contract', e2: 'invoice' }, 'email rocks keep their own texts'),
    ],
  },
  {
    kind: 'plan',
    id: 'pedge-recurring-due-vs-recent',
    title: 'Recurring chore due today rides the chores strip; one done recently never reaches it',
    tags: ['plan', 'edge', 'recurring'],
    // The subject is the CADENCE LADDER'S CUT, measured on both sides in one request: q1 (7-day
    // cadence, last done 7 days ago) is 'due today' and must reach the derived chores strip; q2
    // (14-day cadence, last done 2 days ago) is 'ok', so buildPlanRequest drops it before the
    // request is even built and it must reach nothing.
    //
    // What this scenario does NOT measure, despite an earlier check title claiming it did: whether
    // the model also handed q1 out as a quick win. resolvePlanTaskIds filters chore-matching rocks
    // out (plan-prompt.ts `listed = isAnchored || isChore`) BEFORE the checks ever see the plan, so
    // that assertion is unfailable on the model's behavior — it is only a pin on the filter itself,
    // and it is labeled as one below.
    tasks: [
      task({
        id: 'q1',
        text: 'Scrub the fish tank',
        recurring: { frequencyDays: 7, lastDoneAt: instantOffsetISO(-7, PLAN_NOW), doneCount: 6 },
      }),
      task({
        id: 'q2',
        text: 'Back up the family photos',
        recurring: { frequencyDays: 14, lastDoneAt: instantOffsetISO(-2, PLAN_NOW), doneCount: 3 },
      }),
      task({ id: 'q3', text: 'Assemble the bookshelf', x: 0.5, y: 0.7, size: 'M' }),
    ],
    checks: [
      planHeadline(),
      rocksResolve(),
      choresListed(['q1'], 'the due-today chore reaches the chores strip'),
      // The other side of the ladder's cut, and the check this scenario was missing: a chore done
      // 2 days into a 14-day cadence is 'ok', so it must not appear in the strip either. Widen
      // 'ok' and the card starts nagging about a chore the user just did.
      choresExclude(['q2'], 'the recently-done chore never reaches the chores strip'),
      // A pin on resolvePlanTaskIds' duplicate filter, NOT on the model: a rock naming q1 is
      // dropped before checks run, so this can only fail if that drop regresses and the chore
      // starts showing twice. (deadlinesCovered(['q1']) used to sit here too — the strip is one of
      // the surfaces it scans, so choresListed above already implied it, one line earlier.)
      rocksExclude(['q1'], 'a rock duplicating the chore strip is dropped, not shown twice'),
      rocksExclude(['q2'], 'recently-done chore never scheduled'),
      planNotMentions('family photos', 'recently-done chore not mentioned anywhere'),
    ],
    rubric:
      'Only the fish-tank chore is due (listed by the derived chores strip, machine-checked); ' +
      'the photos backup ran 2 days ago and was dropped from the plan’s input entirely. FAIL if: ' +
      'the plan mentions a photos-backup chore in ANY wording — it is absent from the input, so ' +
      'mentioning it is invention; the prose contradicts the fish-tank chore being due; any ' +
      'other task is invented.',
  },
  {
    kind: 'plan',
    id: 'pedge-paused-upcoming-excluded',
    title: 'A paused task starting in 2 days is never a rock, however important it looks',
    tags: ['plan', 'edge', 'pause', 'dormancy'],
    tasks: KILN_TASKS,
    checks: [rocksExclude(['u1'], 'soon-to-wake paused task never scheduled'), rocksResolve()],
  },
  {
    kind: 'plan',
    id: 'pedge-paused-upcoming-mentioned',
    title: 'A soon-waking paused task: any heads-up stays prose-only, never scheduling',
    tags: ['plan', 'edge', 'pause', 'upcoming'],
    tasks: KILN_TASKS,
    // OWNER DECISION 2026-08-22: the heads-up mention is OPTIONAL — the prompt says the plan "MAY
    // give one a single gentle mention", so the old planMentions('kiln') check required something
    // the prompt only permits and was removed. What survives: the exclusion pin below, and a
    // rubric policing that IF a mention appears it is faithful and never turns into scheduling.
    checks: [rocksExclude(['u1'], 'mention never becomes scheduling')],
    rubric:
      'The kiln task is paused and wakes in 2 days; a mundane active task shares the board; ' +
      'mentioning the kiln task is optional. FAIL if: the kiln task is scheduled, assigned, or ' +
      'framed as actionable today; the prose treats it as due now or misstates when it wakes (it ' +
      'starts in 2 days); a task is invented.',
  },
  {
    kind: 'plan',
    id: 'pedge-emoji-text',
    title: 'Emoji + em-dash + quotes in task text still resolves cleanly',
    tags: ['plan', 'edge', 'text', 'resolution'],
    tasks: [
      task({
        id: 'g1',
        text: '🎸 Practice — set 2 (part "B")',
        x: 0.7,
        y: 0.8,
        size: 'M',
        due: D(0),
      }),
      task({ id: 'g2', text: 'Water the ferns', x: 0.4, y: 0.35, size: 'S' }),
    ],
    checks: [
      planHeadline(),
      rocksResolve(),
      rockScheduled('g1', 'special-char task scheduled and resolved'),
    ],
  },
]
