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
//   recq-fixed-commitment-first    — :38-40, ORDERING only: the appointment is asked about first,
//                                    ahead of the other open items and ahead of the praise beat.
//                                    Exhaustive coverage is deliberately NOT required here.
//   recq-covers-every-open-item    — :37-38, the coverage clause: with three open, all three are
//                                    covered — this scenario is the one that pins that exhaustively.
//   recq-habit-nod-not-the-headline— :43-47, nothing finished ⇒ do NOT reach for something to
//                                    praise; a kept habit is at most ONE optional flourish.
//   recq-upkeep-no-plan-no-praise  — the edge :119-124 creates: bookkeeping with NO plan at all, so
//                                    there are no open items to name (:57-59 — never invent one).
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
    title: 'Fixed commitment leads: the appointment is asked about before any other beat',
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
    // SCOPE: this scenario measures ORDER, not coverage. recap-prompt.ts:38-40 says the fixed
    // commitment "beats any other beat in the message" — so the deterministic checks pin that the
    // physio precedes the other open items AND the praise beat (the cleared inbox, which the first
    // draft left out of the `later` list — the exact hole that let a recap open on the inbox win).
    // Coverage is a FLOOR of one other open item, not all three: "Water the plants" is the most
    // droppable item on the board, and a fully-correct recap that leads on the physio, covers the
    // insurance email, credits the inbox and lets the plants go inside 120 words must not fail a
    // deterministic check. Exhaustive three-of-three coverage is recq-covers-every-open-item's job;
    // the rubric below still asks the judge for it here.
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      mentionsBefore(
        'asks about the physio before the other open items and before the praise',
        // Widened past 'physio': "did the 8:30 appointment go okay?" names the same commitment
        // faithfully, and a needle that misses it would fail a correct, correctly-ordered recap.
        /physio|clinic|appointment|8:30/i,
        [/insurance/i, /\bplant/i, /inbox/i],
      ),
      mentionsAnyOf('covers at least one other open item', ['insurance', 'plant']),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Three things were still open, and one of them is a booked appointment ("Physio appointment ' +
      '— 8:30 at the clinic"). REQUIRED: the appointment is the FIRST thing asked about — ahead of ' +
      'the insurance email, the plants, AND ahead of the praise for the cleared inbox. "Did the ' +
      'physio go okay?" should read as the reason the message exists. Opening with the inbox win ' +
      'and burying the physio is a FAIL. The other open items should also be covered — ideally all ' +
      'three asked about together — but dropping the smallest one ("Water the plants") to stay ' +
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
      'kept. REQUIRED: name both open items and ask how they went. The kept habits may earn AT ' +
      'MOST one small flourish at the edge of the message ("nice that the run still happened") — ' +
      "promoting them into the day's achievement, opening with them, or using them as the thing " +
      'to be proud of is a FAIL, because the rule is to say nothing about achievement rather than ' +
      'reach for something to praise. The rename and the card move are bookkeeping and are not ' +
      'wins. Still warm, still no guilt.',
  },
  {
    // The edge the injected line creates: bookkeeping with NO plan, so there are no open items to
    // "lead with a kind, specific question about". The correct move is a brief kind check-in that
    // neither applauds the organising nor conjures a task to ask about.
    kind: 'recap',
    id: 'recq-upkeep-no-plan-no-praise',
    title: 'Upkeep with no plan: brief and kind, invents nothing to ask about',
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
    // NOTE (verified by rendering this request through buildRecapUserPrompt): because BOOKKEEPING is
    // non-empty, the :119-124 line DOES fire here — the model is told to "lead with a kind, specific
    // question about the open items" when the prompt lists none. That tension IS the probe. No
    // asksSomething() check: recap-prompt.ts:59 lets a plan-less day be "just check in kindly and
    // briefly", and requiring a '?' would reward conjuring something to ask about.
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      bodyLacks(/\bproud\b/i, 'never says "proud" of a day of pure bookkeeping'),
      bodyLacks(/planning day/i, 'never calls it a "planning day"'),
      // Decoys must be INVENTED ITEMS only. "the plan for today" was removed: a truthful, correct
      // reply ("nothing was on the plan for today") contains that substring and would trip the
      // invention canary.
      recapMentionsNone([...DECOYS, 'tax return', 'car service']),
    ],
    rubric:
      'There was NO plan today and nothing was finished — the only activity is three bits of board ' +
      'upkeep (a task created, a card placed, a chore made recurring). REQUIRED: a brief, kind ' +
      'check-in. It does not have to ask a question, because there is nothing open to ask about. ' +
      'AUTOMATIC FAIL if it invents an item, a commitment, or a plan that was never given, or if ' +
      'it manufactures news out of the upkeep — no "good planning day", no "proud of you for ' +
      'getting organised", no treating the three rows as a productive evening. Referring to the ' +
      'upkeep in a passing half-clause is fine. Short is correct here; padding is not.',
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
