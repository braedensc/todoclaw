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
 * Split into named parts because the interesting failure is NOT the obvious scold. The model is
 * handed the gap as a raw fact on the task line ("last worked 41 days ago"), so the likeliest leak
 * by far is it echoing that fact back verbatim — "you last worked on this 41 days ago", "six weeks
 * without progress", "it has been 41 days since your last session". A canary built only from guilt
 * VOCABULARY ("neglect", "fallen behind") misses every one of those, because they are not rude —
 * they are just the gap, said plainly, which is exactly what the prompt bans.
 *
 * So the set covers three shapes: guilt words, second-person "you haven't…" constructions, and any
 * restatement of an ELAPSED DURATION ("41 days ago", "a month since", "for weeks"). Deliberately
 * absent: "pick back up", "chip away", "get back to" — the prompt itself uses that framing, and a
 * correct plan may say it.
 */
const GAP_SHAMING = new RegExp(
  [
    /neglect/,
    /fallen behind|behind on/,
    /haven['’]?t (touched|worked|looked|opened|gotten|been)/,
    /hasn['’]?t (been|seen|had|moved)/,
    /been (a while|weeks|months|sitting|idle|untouched|dormant|parked|quiet)/,
    /since (you|your) last/,
    /last worked/,
    // an elapsed duration in words or digits: "41 days ago", "a month since", "six weeks without"
    /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|a few|a couple of) (day|week|month)s? (ago|since|without)/,
    /for (weeks|months)\b/,
    /catch(?:ing)?[ -]?up/,
    /dust(?:ing|ed)?[ -]?off|gathering dust/,
    /back ?burner/,
    /letting .{0,24}(slip|slide|lapse)/,
    /long (overdue|pause|break|gap|hiatus)|overdue for/,
    /sat idle|went quiet|without progress|abandoned/,
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
      'The only thing on the board is a project the user already put a session into today. The plan ' +
      'must not schedule it, must not ask for a second session on it, and must not backfill the ' +
      'empty slot with invented work — a light or relaxed day is the honest answer. It may ' +
      'acknowledge the work already done warmly. Assigning the novel (again) is a fail; so is ' +
      'manufacturing a task that was never on the board.',
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
    // "worked yesterday, 3 days running" is the strongest leave-it-alone signal in the prompt
    // (plan-prompt.ts: "three or more days in a row — let it rest; something else has earned the
    // day"). That rule is the ONLY thing this fixture may rely on, so the board is deliberately
    // stacked FOR the novel on every other axis: it dominates the grant proposal on BOTH
    // importance (90 vs 70) and urgency (72 vs 60), it is the biggest item (XL vs L), and the
    // ONGOING PROJECTS block tells the planner to PREFER making one the big rock when few deadlines
    // press. Strip the session facts and the novel is the obvious pick.
    //
    // The board is still NOT quiet — the streak rule's escape hatch ("pick it again only if the
    // board is genuinely quiet") must not be what carries the scenario: a real L deliverable is due
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
    rubric:
      'On the raw grid the novel looks like the obvious pick — it is the highest-placed and biggest ' +
      'thing on the board — and that is exactly the trap. It was worked yesterday and three days ' +
      'running, so it should rest today: the day belongs to the grant proposal (due in three days), ' +
      'or to no big rock at all if the planner reads the day as light. Giving the novel the big ' +
      'rock is a fail, and so is parking it in the quick-wins list. The lease email is due today ' +
      'and must appear somewhere. The plan must not scold, must not imply the user owes the project ' +
      'a daily cadence, and must not read their streak back to them as a score to protect.',
  },
  {
    kind: 'plan',
    id: 'pong-long-gap-picked-back-up-no-guilt',
    title: 'A months-old project may earn the day — and the plan never names the gap',
    tags: ['plan', 'ongoing', 'pacing', 'tone'],
    persona: 'user returning to a project they parked in the summer',
    // 41 days is "weeks or months ago": fully fresh, judged on its own merits, and the prompt is
    // explicit that the gap is NEVER named to the user.
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
      // Includes plain restatements of the elapsed time, not just guilt words — see GAP_SHAMING.
      planLacks(GAP_SHAMING, 'no gap-shaming or catch-up framing anywhere in the plan'),
      rocksResolve(),
    ],
    rubric:
      'The atlas project was last worked over a month ago: that makes it fully fresh and a perfectly ' +
      'good pick for the day on its own merits. What must NOT happen is any framing of the gap — no ' +
      '"you have not touched this in weeks", no catching up, no neglect, no guilt, however gently ' +
      'phrased. Putting a project down for a while and coming back to it is normal, healthy use of ' +
      'one. Separately, the novel already has a session logged today and must not be scheduled at all.',
  },
]
