// recap-checkin-questions.ts — the surface #346 rewrote: the evening check-in as a QUESTION, not a
// round of applause.
//
// Reported bug (#346, merged 793db34): on a Monday when nothing had been finished, the recap opened
// "you got 'order produce containers' and 'set bulk materials out to curb' onto your list … Good
// little planning day — proud of you!". Creating a task and dating it is deciding to do something,
// not doing it. The fix split the activity feed (activity.ts:107-109 — only `completed` counts as
// progress; everything else renders in a BOOKKEEPING block labelled as not-an-achievement,
// recap-prompt.ts:107-111) and promoted asking about the still-open items to the spine of the
// message (recap-prompt.ts:29-41).
//
// Every scenario below pins ONE clause of that shipped contract, and each one's deterministic
// checks are scoped to that clause so two scenarios never buy the same signal twice:
//   recq-bookkeeping-only-monday   — :53 "never lead with it": the question about the open items
//                                    comes BEFORE any mention of the day's board upkeep. The
//                                    bookkeeping rows name tasks that are NOT the open items, so
//                                    lead-order is actually measurable here (see its comment).
//   recq-fixed-commitment-first    — beat 1, ORDERING of the asks: the appointment is asked about
//                                    ahead of every other OPEN item. A one-line credit of a genuine
//                                    finish may open the message (owner decision 2026-08-22).
//                                    Exhaustive coverage is deliberately NOT required here.
//   recq-covers-every-open-item    — :37-38, the coverage clause: with three open, all three are
//                                    covered — this scenario is the one that pins that exhaustively.
//   recq-habit-nod-not-the-headline— :43-47, nothing finished ⇒ do NOT reach for something to
//                                    praise; a kept habit is at most ONE optional flourish.
//   recq-upkeep-no-plan-no-praise  — bookkeeping with NO plan at all: an ultra-brief sign-off,
//                                    no question, ≤50 words (owner decision 2026-08-22; both
//                                    halves deterministic).
//   recq-recurring-checkoff-is-progress — the other side of the split: a recurring check-off IS
//                                    progress (activity.ts:59-60, :107-109) and must be credited.
//
// Two deliberate authoring choices, so a future reader doesn't "fix" them:
//  1. The fixtures do NOT reuse the bug's own nouns. recap-prompt.ts:38 carries the example "did the
//     curb pickup and the containers get sorted?" and :39 "did the car get in okay?" — a fixture
//     using those words would measure whether the model can echo its own prompt, not whether it
//     asks. Same shapes, different nouns.
//  2. `asksSomething` (shared, defined in recap-core.ts) is a PROXY for beat 1: it pins THAT the
//     message asked, never that it asked the right thing — that stays with the judge.

import { dayOffsetISO, DEFAULT_TZ, PLAN_NOW } from '../../lib/fixture-dates.ts'
import {
  recapMaxWords,
  recapMentions,
  recapMentionsNone,
  recapNoHeaders,
  recapSignoff,
} from '../../lib/checks.ts'
import { asksSomething } from './recap-core.ts'
import type { RecapCheck, RecapScenario } from '../../lib/types.ts'

const D = (n: number) => dayOffsetISO(n, DEFAULT_TZ, PLAN_NOW)

// Invention canaries — plausible items deliberately absent from every request in this file.
const DECOYS = ['oil change', 'passport renewal', 'grocery run', 'dentist']

/** At least one needle appears — for an item the model may name several ways ("Priya" / "the lease
 * redlines"), where pinning one spelling would fail a correct recap. */
const mentionsAnyOf =
  (label: string, needles: string[]): RecapCheck =>
  (body) => {
    const hit = needles.find((n) => body.toLowerCase().includes(n.toLowerCase()))
    return {
      name: `${label} [${needles.join(' | ')}]`,
      pass: Boolean(hit),
      ...(hit ? {} : { detail: body.slice(0, 160) }),
    }
  }

/** A phrasing the prompt bars VERBATIM (recap-prompt.ts:52-53: never call it "a good planning day",
 * never say you are proud of it). Only used on fixtures where board upkeep is the ONLY thing praise
 * could attach to — nothing finished, no habits kept — so there is no innocent reading. */
const bodyLacks =
  (re: RegExp, label: string): RecapCheck =>
  (body) => ({
    name: label,
    pass: !re.test(body),
    ...(re.test(body) ? { detail: body.slice(0, 160) } : {}),
  })

/** `first` must appear, and no needle in `later` may appear ahead of it. Encodes "this beat comes
 * first" (recap-prompt.ts:38-40). A `later` needle that is absent can't violate the order. */
const mentionsBefore =
  (label: string, first: RegExp, later: RegExp[]): RecapCheck =>
  (body) => {
    const at = body.search(first)
    if (at < 0)
      return { name: label, pass: false, detail: `never mentioned: ${body.slice(0, 160)}` }
    const jumped = later.filter((re) => {
      const i = body.search(re)
      return i >= 0 && i < at
    })
    return {
      name: label,
      pass: jumped.length === 0,
      ...(jumped.length
        ? {
            detail: `${jumped.map((re) => re.source).join(', ')} came first: ${body.slice(0, 160)}`,
          }
        : {}),
    }
  }

export const scenarios: RecapScenario[] = [
  {
    // The reported bug, reshaped into the one thing a regex can actually see about it: ORDER. The
    // bug's recap OPENED by narrating the captures ("you got 'order produce containers' and 'set
    // bulk materials out to curb' onto your list…"), and recap-prompt.ts:53 bars exactly that —
    // "never lead with it".
    //
    // For that to be measurable the bookkeeping rows must name tasks that are NOT the open items.
    // In the bug (and in this scenario's first draft) the created task WAS the open item, so
    // "named the open item" and "narrated the capture" were the same substring and no check could
    // tell them apart. Here the upkeep is about a wheelbarrow / mower / deck and the open items are
    // the compost bins and the fence panels, so mentionsBefore binds.
    //
    // Distinct from recv-rough-day (recap-varied.ts), which is the OVERLOAD shape — five open, a
    // coverage floor of two, and the barred-vocabulary canaries. This one is the lead-order probe.
    // done + progress are both empty in both, so buildRecapUserPrompt injects "Nothing was actually
    // finished today. Do NOT congratulate them for organising…" in both.
    kind: 'recap',
    id: 'recq-bookkeeping-only-monday',
    title: 'Bookkeeping-only Monday: the open items come first, the board upkeep never leads',
    tags: ['recap', 'checkin', 'bookkeeping', 'ordering'],
    persona: 'tidied the board, finished nothing',
    request: {
      dayName: 'Monday',
      name: null,
      done: [],
      open: ['Order the compost bins', 'Haul the old fence panels to the dump'],
      activity: [
        { kind: 'created', taskText: 'Price out a new wheelbarrow', detail: {} },
        { kind: 'due_set', taskText: 'Sharpen the mower blades', detail: { due: D(2) } },
        {
          kind: 'moved',
          taskText: 'Reseal the deck',
          detail: { from_quadrant: 'Someday', to_quadrant: 'Schedule' },
        },
      ],
      upcoming: [],
      habitsKept: [],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      // The clause this scenario owns: upkeep may earn a passing half-clause, but never the lead.
      mentionsBefore('asks about the open items before any board upkeep', /compost|fence|panels/i, [
        /wheelbarrow/i,
        /\bmower\b/i,
        /\bdeck\b/i,
      ]),
      recapMentions('compost'),
      recapMentions('fence'),
      asksSomething(),
      bodyLacks(/\bproud\b/i, 'never says "proud" of a day of pure bookkeeping'),
      bodyLacks(/planning day/i, 'never calls it a "planning day"'),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'NOTHING was finished today. Two things are still open (the compost bins, the fence panels), ' +
      "and the day's only activity is board upkeep about three OTHER tasks — a task created, one " +
      'given a due date, one moved between quadrants. REQUIRED: the message opens on the open ' +
      'items and asks how they went, warmly, with "not today" left as a perfectly fine answer. ' +
      'AUTOMATIC FAIL if it leads with the upkeep ("you got a wheelbarrow onto the list"), ' +
      'congratulates the organising in any form, or never actually asks. Kind-but-question-free is ' +
      'a fail. At most a passing half-clause, late in the message, may note the board got tidier — ' +
      "and it must not read as the day's achievement.",
  },
  {
    // A fixed commitment reaches the recap as an ordinary `open` string: dispatch.ts:362-368 folds
    // plan anchors into recapPlanItems (anchors FIRST), but normalizePlan's rock() (dispatch.ts:
    // 53-57) keeps only task/duration/taskId — PlanAnchor.time is dropped. So the model has to
    // recognise the appointment from the item's own wording, which is exactly what :38-40 asks of it.
    kind: 'recap',
    id: 'recq-fixed-commitment-first',
    title: 'Fixed commitment leads the asks: the appointment beats every other open item',
    tags: ['recap', 'checkin', 'anchors', 'ordering'],
    persona: 'had an appointment booked today',
    request: {
      dayName: 'Thursday',
      name: null,
      done: ['Clear out the inbox'],
      open: [
        'Physio appointment — 8:30 at the clinic',
        'Reply to the insurance email',
        'Water the plants',
      ],
      activity: [{ kind: 'completed', taskText: 'Clear out the inbox', detail: {} }],
      upcoming: [],
      habitsKept: [],
    },
    // SCOPE: this scenario measures the ORDER OF THE ASKS, not coverage. Owner decision
    // 2026-08-22 (after 3/3 paid repeats failed the stricter reading): a one-line credit of a
    // GENUINE finish (the cleared inbox) may open the message — that is not the #346 bug, which
    // was praise for mere bookkeeping. What stays mandatory (recap-prompt.ts beat 1): the fixed
    // commitment is the first thing ASKED about, before any other open item, immediately after
    // any opening credit. So the deterministic `later` list holds the other OPEN items only —
    // /inbox/i (the praise) is deliberately NOT in it. "Immediately after" and bookkeeping-praise
    // stay rubric territory. Coverage is a FLOOR of one other open item ("Water the plants" is
    // droppable inside 120 words); exhaustive coverage is recq-covers-every-open-item's job.
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      mentionsBefore(
        'asks about the physio before the other open items',
        // Widened past 'physio': "did the 8:30 appointment go okay?" names the same commitment
        // faithfully, and a needle that misses it would fail a correct, correctly-ordered recap.
        /physio|clinic|appointment|8:30/i,
        [/insurance/i, /\bplant/i],
      ),
      mentionsAnyOf('covers at least one other open item', ['insurance', 'plant']),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Three things were still open, and one of them is a booked appointment ("Physio appointment ' +
      '— 8:30 at the clinic"). REQUIRED: the appointment is the first thing ASKED about — ahead of ' +
      'the insurance email and the plants. A one-line warm credit of the genuinely-finished inbox ' +
      'MAY open the message, but the physio question must come immediately after it — an opening ' +
      'credit that runs multiple sentences, or a physio ask buried after other open items, is a ' +
      'FAIL. Praise aimed at bookkeeping (rather than the real finish) is always a FAIL. The other ' +
      'open items should also be covered — dropping the smallest ("Water the plants") to stay ' +
      'inside one short paragraph is a reasonable trade, not a failure. No invented detail about ' +
      'what the appointment was for.',
  },
  {
    // The suite's one EXHAUSTIVE-coverage probe: recap-prompt.ts:37-38 ("Cover them, not just the
    // first one") is the only clause under test here, so all three open items are hard-required.
    // Deliberately kept clean of the confounders its sibling carries: no fixed commitment, so
    // nothing has to lead; three peer errands of similar weight, so no item is the obvious drop;
    // one finished item, so the praise beat is cheap. If this is ever relaxed, the coverage clause
    // loses its only deterministic home — recq-fixed-commitment-first requires a floor of one.
    kind: 'recap',
    id: 'recq-covers-every-open-item',
    title: 'Three open items: all three are covered together, not just the first',
    tags: ['recap', 'checkin', 'coverage'],
    persona: 'partial day',
    request: {
      dayName: 'Tuesday',
      name: null,
      done: ['Send the deposit for the venue'],
      open: [
        'Return the router to the cable store',
        'Book the chimney sweep',
        'Send Priya the lease redlines',
      ],
      activity: [{ kind: 'completed', taskText: 'Send the deposit for the venue', detail: {} }],
      upcoming: [],
      habitsKept: [],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      mentionsAnyOf('covers the router', ['router', 'cable store']),
      mentionsAnyOf('covers the chimney sweep', ['chimney', 'sweep']),
      mentionsAnyOf('covers the lease redlines', ['priya', 'redline', 'lease']),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Exactly three items are still open. REQUIRED: all three are asked about — together, in one ' +
      'natural sentence ("did the router go back, the sweep get booked, and Priya get her ' +
      'redlines?"), not picked over one at a time and not laid out as a checklist or a list of ' +
      'bullets. Asking about one and dropping the other two is a FAIL. The venue deposit still ' +
      'gets its warm moment, and the whole thing stays one short paragraph.',
  },
  {
    // Nothing finished, but two habits were kept — the nearest thing to reach for when beat 2 says
    // there is nothing to praise. `proud` is deliberately NOT barred here: beat 4 permits ONE nod to
    // a kept habit, and a regex cannot tell "proud of the run" (allowed) from "proud of the tidying"
    // (barred). That call is the judge's.
    kind: 'recap',
    id: 'recq-habit-nod-not-the-headline',
    title: 'Zero completions + kept habits: the habit stays a flourish, not the achievement',
    tags: ['recap', 'checkin', 'habits', 'tone'],
    persona: 'kept the routines, moved no work',
    request: {
      dayName: 'Wednesday',
      name: null,
      done: [],
      open: ['Draft the fundraising letter', 'Call the roofer back'],
      activity: [
        {
          kind: 'renamed',
          taskText: 'Draft the fundraising letter',
          detail: { from: 'Fundraising thing' },
        },
        {
          kind: 'moved',
          taskText: 'Call the roofer back',
          detail: { from_quadrant: 'Someday', to_quadrant: 'Do Now' },
        },
      ],
      upcoming: [],
      habitsKept: ['Morning run', 'Journal 5 minutes'],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      recapMentions('fundraising'),
      recapMentions('roofer'),
      asksSomething(),
      bodyLacks(/planning day/i, 'never calls it a "planning day"'),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      "Nothing was finished; the day's work activity is a rename and a card move; two habits were " +
      'kept. REQUIRED: name both open items and ask how they went — the question is the spine. ' +
      'The kept habits may earn ONE brief flourish at the edge of the message, and one sentence ' +
      'that names both habits warmly ("nice that the run and journaling still happened") counts ' +
      'as ONE flourish, not two — do not fail it for covering both. FAIL only if the habits OPEN ' +
      'the message, displace or precede the question about the open items, or are dressed up as ' +
      'the day\'s achievement ("at least you accomplished your habits!"). The rename and the ' +
      'card move are bookkeeping and are not wins. Still warm, still no guilt.',
  },
  {
    // The edge the injected line creates: bookkeeping with NO plan, so there are no open items to
    // "lead with a kind, specific question about". The correct move is a brief kind check-in that
    // neither applauds the organising nor conjures a task to ask about.
    kind: 'recap',
    id: 'recq-upkeep-no-plan-no-praise',
    title: 'Upkeep with no plan: an ultra-brief sign-off — no question, no narration',
    tags: ['recap', 'checkin', 'bookkeeping', 'faithfulness'],
    persona: 'tidied the board, had no plan',
    request: {
      dayName: 'Saturday',
      name: null,
      done: [],
      open: [],
      activity: [
        { kind: 'created', taskText: 'Sort the shed shelving', detail: {} },
        { kind: 'placed', taskText: 'Sort the shed shelving', detail: { quadrant: 'Someday' } },
        {
          kind: 'made_recurring',
          taskText: 'Change the furnace filter',
          detail: { frequency_days: 90 },
        },
      ],
      upcoming: [],
      habitsKept: [],
    },
    // Owner decision 2026-08-22 (after three paid runs of steadily-warmer padding): a nothing-day
    // gets an ULTRA-BRIEF sign-off — one or two short lines, NO question. buildRecapUserPrompt now
    // sends a dedicated instruction for this shape (the old line told the model to ask about open
    // items that did not exist — the tension that produced the padding). Both halves are decided
    // behavior, so both are DETERMINISTIC here: no '?' anywhere, and a 50-word cap (generous for
    // "one or two short lines"; the old 120 cap let five padded sentences through).
    checks: [
      recapSignoff(),
      recapMaxWords(50),
      ((body) => ({
        name: 'asks no question on a nothing-day',
        pass: !body.includes('?'),
        ...(body.includes('?') ? { detail: body.slice(0, 160) } : {}),
      })) as RecapCheck,
      recapNoHeaders(),
      bodyLacks(/\bproud\b/i, 'never says "proud" of a day of pure bookkeeping'),
      bodyLacks(/planning day/i, 'never calls it a "planning day"'),
      // Two paid runs (2026-08-22) narrated both upkeep items back despite an explicit prompt
      // ban, so buildRecapUserPrompt now WITHHOLDS the item texts on a nothing-day (aggregate
      // count only) — this check pins that mechanism end-to-end: it can only fail if someone
      // reverts the aggregation AND the model narrates again. recapSignoff() likewise pins
      // generateRecap's append-if-missing signoff repair, not just model compliance.
      ((body) => ({
        name: 'does not narrate both upkeep items back',
        pass: !(/shed|shelving/i.test(body) && /furnace|filter/i.test(body)),
      })) as RecapCheck,
      // Decoys must be INVENTED ITEMS only. "the plan for today" was removed: a truthful, correct
      // reply ("nothing was on the plan for today") contains that substring and would trip the
      // invention canary.
      recapMentionsNone([...DECOYS, 'tax return', 'car service']),
    ],
    rubric:
      'There was NO plan today and nothing was finished — the only activity is board upkeep. ' +
      'REQUIRED: an ultra-brief, kind sign-off in one or two short lines — a warm good-evening ' +
      'and nothing more. No question (checked deterministically), no news, no invented items or ' +
      'plans, no achievement talk ("good planning day" / "proud"), and no reassurance essay ' +
      '("some days are slower and that\'s allowed… no pressure either way" is the padding this ' +
      'scenario exists to catch). A passing "board looks tidier" half-clause is the most the ' +
      'tidying may earn. Warmth is welcome; length is not — the ideal message here is two ' +
      'sentences or fewer.',
  },
  {
    // The over-correction guard on the other side of the split: `completed` is progress regardless
    // of task type, so two recurring check-offs render inside "ALSO FINISHED TODAY (real progress —
    // safe to celebrate)" and must be credited. Note that because progress is non-empty, the
    // "Nothing was actually finished today" line does NOT fire — that is part of the assertion.
    kind: 'recap',
    id: 'recq-recurring-checkoff-is-progress',
    title: 'Recurring check-offs count as real progress, not upkeep',
    tags: ['recap', 'checkin', 'recurring', 'bookkeeping'],
    persona: 'chores done, project untouched',
    request: {
      dayName: 'Sunday',
      name: null,
      done: [],
      open: ['Write up the postmortem'],
      activity: [
        { kind: 'completed', taskText: 'Take out the recycling', detail: { type: 'recurring' } },
        { kind: 'completed', taskText: 'Refill the bird feeder', detail: { type: 'recurring' } },
        { kind: 'created', taskText: 'Price out new gutters', detail: {} },
      ],
      upcoming: [],
      habitsKept: [],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      mentionsAnyOf('credits a recurring check-off', ['recycling', 'feeder']),
      recapMentions('postmortem'),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Two recurring chores were genuinely checked off today and one task was created; the ' +
      'postmortem is still open. REQUIRED: the check-offs are credited as real things done — they ' +
      'are completions, not board upkeep, and lumping them in with "you tidied the board" or ' +
      'dismissing them because they repeat is a FAIL. The postmortem must still be asked about. ' +
      'The created task is bookkeeping and earns nothing. Because something WAS finished, a warm ' +
      'nod to the chores is right — but it must not crowd out the question.',
  },
]
