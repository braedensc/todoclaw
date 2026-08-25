// plan-ongoing-sessions.ts — Plan My Day's pacing of ONGOING PROJECTS off their session history.
//
// Pins PR #347 ("log work sessions instead of archiving, and pace them"), merged 2026-08-18.
// These ran as expectFailUntil while #347 was open; the tags were retired on merge (per the
// harness rule that a tag must genuinely fail on main) and the scenarios are ordinary
// expected-pass now. Without #347's session facts the planner would see a project the user
// already spent the day on as an ordinary, very tempting big-rock candidate.
//
// What each scenario pins:
//  - pong-worked-today-off-the-table      — worked-today is STRUCTURALLY unschedulable, not a rule
//    the model is asked to follow: taskLines drops it from the candidates, the ALREADY WORKED TODAY
//    block carries no [T#], and resolvePlanTaskIds' keep()/isWorkedToday drops any rock or nudge
//    that reaches it by text anyway.
//  - pong-worked-today-keeps-its-anchor   — the trap the PR avoided. The skip lives in the RENDERER,
//    not buildPlanRequest, because req.tasks also feeds deriveAnchors: filtering upstream would
//    strip the 2 PM anchor off an ongoing project the user logged a session on (the #344/#345
//    regression).
//  - pong-worked-yesterday-yields-the-slot— the soft pacing rule: worked yesterday (here a 3-day run
//    ending yesterday) is not big-rock eligible unless the board is genuinely quiet.
//  - pong-long-gap-picked-back-up-no-guilt— a months-old project is fully fresh and may earn the day,
//    but the plan must NEVER name the gap or imply neglect.
//
// EVERY fixture here is stacked so a failure can come from the session facts going missing and
// NOTHING ELSE — the board is deliberately stacked FOR the project the pacing rule must keep off
// the plan. The trap when authoring one of these is a board where the planner's other rules
// already point away from the project — then the scenario passes even if #347's pacing regresses,
// and the coverage is silently zero. So in each fixture the ongoing project that must NOT be
// scheduled is the strongest SCHEDULABLE thing on the board — it outranks every other rock
// candidate on both axes and on size — and anything due today is either an anchor the app
// surfaces itself or an S a quick win covers, so the rule-1 deadline gate never does the work the
// pacing rule is supposed to do. (Originally verified by rendering buildUserPrompt over these
// fixtures on both pre- and post-#347 trees.)
//
// Clock pinned: every date derives from PLAN_NOW (a Tuesday) via dayOffsetISO — rot-free forever.
//
// Typing note: evals/lib/types.ts PlanTaskRow still has no `worked_days` (plan-inputs.ts TaskRow
// gained it in #347). runner.ts passes `sc.tasks` straight into the real buildPlanRequest, so the
// key only needs to survive at RUNTIME — the local WorkedTaskRow alias below carries it through
// without touching evals/lib. Worth folding into PlanTaskRow eventually.

import { dayOffsetISO, DEFAULT_TZ, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  deadlinesCovered,
  nudgeContract,
  planHeadline,
  restDay,
  rocksResolve,
  smallRocksOnlySM,
} from '../../lib/checks.ts'
import type { PlanCheck, PlanResult, PlanScenario, PlanTaskRow } from '../../lib/types.ts'

const D = (n: number) => dayOffsetISO(n, DEFAULT_TZ, PLAN_NOW)

/** A fixture row that can carry a session log. Structurally a PlanTaskRow plus the column #347 adds
 * to plan-inputs.ts TaskRow (local 'YYYY-MM-DD' days, newest-first). */
type WorkedTaskRow = PlanTaskRow & { worked_days?: string[] | null }

function task(over: Partial<WorkedTaskRow> & { id: string; text: string }): WorkedTaskRow {
  const row: WorkedTaskRow = {
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
  return row
}

// ---------- local checks (this file owns them; evals/lib stays untouched) ----------

type Rock = NonNullable<PlanResult['bigRock']>

/** Every slot that puts work in front of the user today: both rock slots AND the nudge (a nudge is
 * a suggestion to do the thing, so it counts as "planned" for a project that is off the table). */
function plannedItems(plan: PlanResult): Array<{ task: string; taskId: string | null }> {
  const rocks: Rock[] = [plan.bigRock, ...plan.smallRocks].filter((r): r is Rock => r != null)
  return plan.nudge ? [...rocks, plan.nudge] : rocks
}

/**
 * None of these fixture tasks may be planned — matched by taskId AND by exact emitted text.
 * The text arm is the load-bearing one: resolveRef falls back to an exact-text match, so a project
 * the model only saw BY NAME (the id-less ALREADY WORKED TODAY block) could otherwise still resolve
 * to a real taskId. That fallback is exactly the hole isWorkedToday closes.
 */
function neverPlanned(ids: string[], texts: string[], label: string): PlanCheck {
  return (plan) => {
    const wantedText = texts.map((t) => t.trim().toLowerCase())
    const bad = plannedItems(plan).filter(
      (item) =>
        (item.taskId != null && ids.includes(item.taskId)) ||
        wantedText.includes(item.task.trim().toLowerCase()),
    )
    return {
      name: label,
      pass: bad.length === 0,
      ...(bad.length
        ? {
            detail: `planned: ${bad.map((b) => `"${b.task}" (${b.taskId ?? 'unresolved'})`).join('; ')}`,
          }
        : {}),
    }
  }
}

/** A task due today at a set time must land in the deterministic `anchors` strip. */
function anchored(id: string, label: string): PlanCheck {
  return (plan) => {
    const anchor = plan.anchors.find((a) => a.taskId === id)
    return {
      name: label,
      pass: anchor != null,
      detail: anchor ? `${anchor.time} — ${anchor.task}` : `anchors: ${plan.anchors.length}`,
    }
  }
}

/** This task may appear elsewhere, but it must not own the day. */
function bigRockIsNot(id: string, label: string): PlanCheck {
  return (plan) => {
    const pass = plan.bigRock?.taskId !== id
    return {
      name: label,
      pass,
      ...(pass ? {} : { detail: `bigRock: "${plan.bigRock?.task}"` }),
    }
  }
}

/**
 * Every way a plan can NAME THE GAP since an ongoing project's last session — the thing
 * plan-prompt.ts forbids outright ("NEVER name the gap to the user and never imply neglect").
 *
 * OWNER DECISION 2026-08-24 — this canary was INVERTED. It used to ban the gap itself: "last
 * worked", "six weeks without progress", any elapsed duration. The owner's ruling is that the gap
 * is the user's own data and saying it plainly is USEFUL, not shaming ("don't baby the user; what
 * matters is accurate info"). A pointed nudge is fine too. The only floor is a verdict on the
 * PERSON rather than a fact about the work — so that is all this catches now.
 *
 * Kept deliberately NARROW and high-signal: every pattern below is unambiguously about the user's
 * character, so it cannot fire on an honest sentence. If a cheap model ever starts moralising, this
 * is what notices; ordinary bluntness passes straight through.
 */
const CHARACTER_JUDGEMENT = new RegExp(
  [
    // sweeping "you always/never <negative verb>" generalisations about the person
    /you (always|never|constantly) [^.!?]{0,30}(abandon|drop|forget|ignore|neglect|put off|leave|fail|slip|quit)/,
    /you keep (abandoning|dropping|ignoring|neglecting|putting off|forgetting|quitting)/,
    // direct character labels
    /you'?re (lazy|flaky|unreliable|undisciplined|hopeless|terrible|bad) (at|with)?/,
    /(bad|terrible|hopeless|no good) at (follow|sticking|finishing|keeping|committing)/,
    /lack of (discipline|follow.?through|commitment|willpower|effort)/,
    // moralising / reproach aimed at the person
    /shame on you|you should be ashamed|what'?s wrong with you/,
    /if you (actually|really) (cared|wanted|tried)/,
    /you have (only|just) yourself to blame/,
  ]
    .map((part) => part.source)
    .join('|'),
  'i',
)

/** Phrase canary over the WHOLE emitted plan (headline, availableTime, every rock's why, habitNote,
 * nudge) — the plan text is the only user-visible surface a check can reach. */
function planLacks(match: RegExp, label: string): PlanCheck {
  return (plan) => {
    const blob = JSON.stringify(plan)
    const hit = blob.match(match)
    return {
      name: label,
      pass: hit == null,
      ...(hit ? { detail: `matched "${hit[0]}"` } : {}),
    }
  }
}

// ---------- scenarios ----------

export const scenarios: PlanScenario[] = [
  {
    kind: 'plan',
    id: 'pong-worked-today-off-the-table',
    title: 'A project already worked today is not on the table — the day goes light instead',
    tags: ['plan', 'ongoing', 'worked-today', 'pacing'],
    persona: 'user who already did their session before opening the app',
    // The ONLY grid task is an ongoing project with a session logged today (and two days before).
    // The rock candidates come back EMPTY — taskLines renders "(nothing on the grid is available
    // today — see ALREADY WORKED TODAY)" — so a light day is the honest read. Without the session
    // facts the planner would see a high-placed L project with nothing competing and make it the
    // big rock, which is exactly the regression this scenario exists to catch.
    tasks: [
      task({
        id: 'wt1',
        text: 'Write the novel',
        x: 0.55,
        y: 0.85,
        size: 'L',
        ongoing: true,
        worked_days: [D(0), D(-1), D(-2)],
      }),
    ],
    habits: [{ text: 'Morning stretch', active: true }],
    checks: [
      planHeadline(),
      restDay(),
      neverPlanned(['wt1'], ['Write the novel'], 'the already-worked project is never scheduled'),
      // A nudge pointing at the worked-today project is dropped by resolvePlanTaskIds; anything
      // that survives must still obey the nudge contract (no big rock, resolves to a real task).
      nudgeContract(),
      rocksResolve(),
    ],
    rubric:
      'The only task is an ongoing novel with a session already logged today, three days running ' +
      '(worked_days is in the fixture above); one active habit, Morning stretch. The no-rocks ' +
      'rest day and the exclusion are machine-checked. Naming the run warmly ("three days ' +
      'running") and nodding at the seeded habit are both grounded and fine. FAIL if: the prose ' +
      'asks for or suggests a second session on the novel today; work not on the board is ' +
      'invented or assigned; the user is pressured to do more today, or told they owe the ' +
      'project a daily cadence.',
  },
  {
    kind: 'plan',
    id: 'pong-worked-today-keeps-its-anchor',
    title: 'Worked-today drops the rock, never the fixed-time anchor',
    tags: ['plan', 'ongoing', 'worked-today', 'anchors', 'regression'],
    persona: 'ongoing project with a booked studio slot at 2 PM',
    // The trap: the worked-today skip lives in the RENDERER because req.tasks also feeds
    // deriveAnchors. 'Studio session' proves the anchor survives; 'Write the novel' is what makes
    // this discriminate — a rock on the studio alone would be dropped by main's existing isAnchored
    // rule, so the anchored task cannot fail main on its own.
    //
    // The dry cleaning is due TODAY (S, no time, so deriveAnchors ignores it) purely to keep the
    // scenario discriminating. Without it the only due-today item is the 2 PM anchor, and rule 1
    // ("never hand a slot to an undated task while something due today is still unplanned") can be
    // read as blocking the novel — the planner would then emit bigRock null for a reason that has
    // nothing to do with the worked-today skip, and a regression of that skip would go unnoticed.
    // A due-today quick win closes that gate the way rule 1 intends, leaving the big-rock slot
    // genuinely open.
    tasks: [
      task({
        id: 'an1',
        text: 'Studio session',
        x: 0.7,
        y: 0.8,
        size: 'L',
        ongoing: true,
        due: D(0),
        due_time: '14:00:00',
        worked_days: [D(0)],
      }),
      task({
        id: 'an2',
        text: 'Write the novel',
        x: 0.55,
        y: 0.85,
        size: 'L',
        ongoing: true,
        worked_days: [D(0), D(-1)],
      }),
      task({ id: 'an3', text: 'Pick up the dry cleaning', x: 0.45, y: 0.25, size: 'S', due: D(0) }),
    ],
    checks: [
      planHeadline(),
      anchored('an1', 'the 2 PM studio session keeps its fixed-time anchor'),
      neverPlanned(
        ['an1', 'an2'],
        ['Studio session', 'Write the novel'],
        'neither already-worked project is scheduled as a rock or a nudge',
      ),
      rocksResolve(),
    ],
  },
  {
    kind: 'plan',
    id: 'pong-worked-yesterday-yields-the-slot',
    title:
      'Three days running and worked yesterday: the project rests, real deadlines take the day',
    tags: ['plan', 'ongoing', 'pacing', 'deadlines'],
    persona: 'mid-push writer with actual deadlines this week',
    // OWNER DECISION 2026-08-25: a project worked yesterday YIELDS the big-rock slot to real
    // deadline work. The rung this comment used to cite ("three or more days in a row — let it
    // rest") was DELETED by #382 and is NOT coming back — several days running is the user's call.
    // What carries the fixture now is the worked-yesterday rung, whose escape hatch was tightened
    // in the same decision: being mid-push wins the slot against undated work, never against a
    // deadline. That rule is the ONLY thing this fixture may rely on, so the board is deliberately
    // stacked FOR the novel on every other axis: it dominates the grant proposal on BOTH
    // importance (90 vs 70) and urgency (72 vs 60), it is the biggest item (XL vs L), and the
    // ONGOING PROJECTS block tells the planner to PREFER making one the big rock when few deadlines
    // press. Strip the session facts and the novel is the obvious pick.
    //
    // The board is still NOT quiet — the "genuinely quiet" escape hatch must not be what carries
    // the scenario either: a real L deliverable is due
    // in 3 days and an S is due today, so the pacing rule has somewhere honest to hand the day.
    // The S also clears the rule-1 deadline gate as a quick win, which is what keeps the big-rock
    // slot genuinely contested.
    tasks: [
      task({
        id: 'wy1',
        text: 'Write the novel',
        x: 0.72,
        y: 0.9,
        size: 'XL',
        ongoing: true,
        worked_days: [D(-1), D(-2), D(-3)],
      }),
      task({
        id: 'wy2',
        text: 'Finish the grant proposal',
        x: 0.6,
        y: 0.7,
        size: 'L',
        due: D(3),
      }),
      task({ id: 'wy3', text: 'Reply to the lease email', x: 0.8, y: 0.5, size: 'S', due: D(0) }),
    ],
    checks: [
      planHeadline(),
      bigRockIsNot('wy1', 'the 3-days-running project does not own the day'),
      // …and it must not sneak in as a "quick win" either: an XL is never a small rock.
      smallRocksOnlySM(),
      deadlinesCovered(['wy3']),
      rocksResolve(),
    ],
    // Owner decision 2026-08-24: celebrating a real run of sessions is FINE, so the old
    // "reads the streak back as a score" clause is gone. What survives is mandate-backed —
    // plan-prompt.ts still bans framing a cadence the user OWES, and scolding is universal.
    rubric:
      'The novel (XL, ongoing) was worked yesterday and 3 days running; its big-rock exclusion, ' +
      'sizes, and deadline coverage are machine-checked. FAIL if: the user is scolded or ' +
      'guilt-tripped about resting the project or about the day’s load; the prose implies the ' +
      'user OWES the project a daily cadence, or treats a run of sessions as something they must ' +
      'not break (warmly noting the run itself is fine); a task or deadline is invented.',
  },
  {
    kind: 'plan',
    id: 'pong-long-gap-picked-back-up-no-guilt',
    title:
      'A months-old project may earn the day — the gap may be named, the user may not be judged',
    tags: ['plan', 'ongoing', 'pacing', 'tone'],
    persona: 'user returning to a project they parked in the summer',
    // 41 days is "weeks or months ago": fully fresh and judged on its own merits. OWNER DECISION
    // 2026-08-24: naming the gap is ALLOWED and useful ("last worked 41 days ago", "this one has
    // gone quiet"), and a pointed nudge is fine — only a verdict on the person is barred. This
    // scenario used to fail exactly the honest phrasing the owner wants.
    //
    // A worked-today-skip regression has to surface through the decoy, so the decoy is not a
    // near-twin of the atlas: 'Write the novel' (worked today) outranks it on BOTH axes
    // (importance 90 vs 80, urgency 78 vs 50) and is the bigger item (XL vs L). A planner blind to
    // the session facts sees the strongest thing on the board and grabs it — neverPlanned then
    // fails for the right reason. Two similarly-placed projects would have made this a coin flip.
    tasks: [
      task({
        id: 'lg1',
        text: 'Restore the atlas',
        x: 0.5,
        y: 0.8,
        size: 'L',
        ongoing: true,
        worked_days: [D(-41)],
      }),
      task({
        id: 'lg2',
        text: 'Write the novel',
        x: 0.78,
        y: 0.9,
        size: 'XL',
        ongoing: true,
        worked_days: [D(0)],
      }),
      task({ id: 'lg3', text: 'Wipe down the kitchen counters', x: 0.3, y: 0.25, size: 'S' }),
    ],
    checks: [
      planHeadline(),
      neverPlanned(['lg2'], ['Write the novel'], 'the project worked today is never scheduled'),
      // The gap-shaming canary, across headline / availableTime / every `why` / habitNote / nudge.
      // Only person-verdicts now — saying "last worked 41 days ago" is allowed and useful.
      planLacks(CHARACTER_JUDGEMENT, 'no verdict on the user as a person'),
      rocksResolve(),
    ],
    rubric:
      'The atlas was last worked 41 days ago (fully fresh, a fine pick on its merits); the novel ' +
      'already has a session logged today. Saying how long the atlas has sat is ALLOWED and ' +
      'useful — "last worked 41 days ago", "this one has gone quiet", "worth a session" all pass, ' +
      'and a pointed nudge is fine. FAIL if: the text judges the USER rather than the work ("you ' +
      'always abandon these", "bad at follow-through"), or grinds the same reproach through the ' +
      'whole card; the prose schedules or requests work on the novel today; a task is invented.',
  },
]
