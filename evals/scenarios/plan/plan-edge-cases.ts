// plan-edge-cases.ts — boundary conditions for the planner: all-due-today crunch, habit-only
// boards, deep-overdue focus, fixed-time anchors, near-duplicate texts, recurring due-vs-recent,
// soon-to-wake paused tasks, and funky task text. Clock pinned: every date derives from PLAN_NOW
// (a Tuesday) via dayOffsetISO — rot-free forever.

import { dayOffsetISO, DEFAULT_TZ, instantOffsetISO, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  bigRockNeverS,
  planHeadline,
  restDay,
  rocksExclude,
  rocksResolve,
  smallRocksAtMost,
  smallRocksOnlySM,
} from '../../lib/checks.ts'
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

/** If the task appears as a rock at all, it must sit in the given slot (vacuous pass otherwise —
 * whether it SHOULD appear is the rubric's call). */
function rockSlotIfScheduled(id: string, slot: Rock['when'], label: string): PlanCheck {
  return (plan) => {
    const rock = allRocks(plan).find((r) => r.taskId === id)
    if (!rock) return { name: label, pass: true, detail: 'not emitted as a rock (vacuous)' }
    return { name: label, pass: rock.when === slot, detail: `slot: ${rock.when}` }
  }
}

/** Substring probe over the WHOLE emitted plan (headline, availableTime, rocks, habitNote). */
function planMentions(needle: string, label: string): PlanCheck {
  return (plan) => ({
    name: label,
    pass: JSON.stringify(plan).toLowerCase().includes(needle.toLowerCase()),
  })
}

function planNotMentions(needle: string, label: string): PlanCheck {
  return (plan) => ({
    name: label,
    pass: !JSON.stringify(plan).toLowerCase().includes(needle.toLowerCase()),
  })
}

// ---------- shared fixtures ----------

// Soon-to-wake paused task (starts in 2 days = Thursday) + a mundane active companion so the day
// isn't a rest day. Used by both the exclusion and the mention scenario below.
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
    ],
    rubric:
      'Everything is due today: the plan must triage, not panic — one substantive big rock, at ' +
      'most two quick wins, and honest framing that not all five will fit. Cramming all five ' +
      'into the day or an alarmist tone is a fail.',
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
      'No tasks at all: the day reads as light/rest with no invented work, and habitNote ' +
      'genuinely engages with the two habits (ideally by name) rather than a throwaway line.',
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
      "The only task is 5 days overdue — it should be today's clear focus, acknowledged as " +
      'overdue matter-of-factly, without scolding or drama.',
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
      rockSlotIfScheduled('t1', 'afternoon', 'timed demo lands in the afternoon slot'),
    ],
    rubric:
      'The demo is fixed at 3pm today: the plan must treat it as an afternoon anchor — never ' +
      'suggest doing it this morning or "getting it out of the way early" — and slot the ' +
      'flexible release notes around it.',
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
    title: 'Recurring chore due today may surface; one done recently stays invisible',
    tags: ['plan', 'edge', 'recurring'],
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
      rocksExclude(['q2'], 'recently-done chore never scheduled'),
      planNotMentions('family photos', 'recently-done chore not mentioned anywhere'),
    ],
    rubric:
      'Only the fish-tank chore is due (the photos backup ran 2 days ago). The plan may surface ' +
      'the fish tank as a quick win or mention, and must not bring up the photos backup at all.',
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
    title: 'A paused task starting in 2 days gets a heads-up mention in the plan prose',
    tags: ['plan', 'edge', 'pause', 'upcoming'],
    tasks: KILN_TASKS,
    checks: [
      rocksExclude(['u1'], 'mention never becomes scheduling'),
      planMentions('kiln', 'plan prose mentions the soon-to-wake task'),
    ],
    rubric:
      'The kiln task wakes in 2 days (Thursday) and is high-stakes: the ideal plan drops a ' +
      'one-line heads-up in the headline/availableTime prose WITHOUT scheduling it today.',
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
