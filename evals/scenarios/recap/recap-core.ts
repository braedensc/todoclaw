// recap-core.ts — evening check-in fundamentals: the format contract (sign-off, length, no
// headers), the no-invention rule probed with DECOYS (plausible task names deliberately absent from
// the request; if the recap mentions one, the model invented), and — since #346 — the SPINE of the
// message: naming the still-open plan items and ASKING how they went.
//
// This file also owns `asksSomething`, the recap lane's shared "it asked" predicate (imported by
// recap-checkin-questions.ts and recap-varied.ts). It lives here rather than in lib/checks.ts
// because that module is shared with the chat/plan lanes; the recap lane owns this one.
//
// #346 ("ask how the day went instead of applauding the bookkeeping") rewrote
// _shared/recap-prompt.ts and inverted the beat order. Both scenarios in this file pre-date that
// rewrite and encoded the OLD praise-led contract:
//   - recap-productive-day required the habit nod + tomorrow heads-up (now explicitly "Optionally",
//     recap-prompt.ts:45-47) and never checked that the open item is asked about at all.
//   - recap-empty-day called the question OPTIONAL ("may gently point at the one open item"), but
//     with done/progress empty buildRecapUserPrompt now injects a MANDATORY instruction
//     (recap-prompt.ts:119-124: "lead with a kind, specific question about the open items").
// Both now pin the shipped contract: beat 1 is the question (recap-prompt.ts:29-41 — "If you don't
// ask it, the message has failed, however nice it sounds"), praise is beat 2, the rest is trim.

import {
  recapMaxWords,
  recapMentions,
  recapMentionsNone,
  recapNoHeaders,
  recapSignoff,
} from '../../lib/checks.ts'
import type { RecapCheck, RecapScenario } from '../../lib/types.ts'

const DECOYS = ['laundry', 'dentist', 'groceries', 'gym session']

/** At least one needle appears — for an item a faithful recap may name several ways ("the slides" /
 * "the team sync deck"), where pinning one spelling would fail a correct reply. */
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

// ---------- the shared "it asked" predicate ----------

/** A sentence (or trailing clause) that ends in '?'. Runs of them are matched separately. */
const QUESTION_SEGMENT = /[^.!?\n]*\?/g

/** Interrogative signal: a wh-word, an auxiliary/modal (incl. n't forms), "any…", or second person.
 * Deliberately generous — a missing signal must be the exception, not the common case. */
const INTERROGATIVE =
  /\b(how|what|when|where|which|who|why|any|anything|anyone|you|your|ya)\b|\b(did|do|does|is|are|was|were|has|have|had|will|would|can|could|should|shall)(n['’]?t)?\b/i

/** Asking without a '?' — the imperative invitation to report back. */
const INVITATION =
  /\b(let me know|tell me|fill me in|update me|catch me up|i['’]?d love to hear|i['’]?m curious|give me the (scoop|rundown)|report back)\b/i

/** A wh-shell the writer answers themselves ("Who's a good planner? You are!") asks nothing. Scoped
 * to wh-shells on purpose: "Did the physio go? Yes or no, both fine." IS an ask and must survive. */
const WH_SHELL = /^[^a-z]*\b(who|what)\b/i
const SELF_ANSWER =
  /^[\s"'“”)*_]*((you|that|it|we)\s+(are|is|was|were|did|do)\b|absolutely|exactly|definitely|of course)/i

const STOP_WORDS = new Set([
  'about',
  'back',
  'from',
  'into',
  'more',
  'next',
  'onto',
  'over',
  'some',
  'that',
  'the',
  'their',
  'them',
  'then',
  'they',
  'this',
  'with',
  'your',
])

/** Content words from the scenario's own open items, for the terse-ask path below. */
function openItemWords(items: string[]): string[] {
  const words = items.flatMap((item) => item.toLowerCase().split(/[^a-z]+/))
  return [...new Set(words)].filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
}

/**
 * "It asked" — the deterministic spine check, shared by every scenario file in the recap lane.
 *
 * The naive version was `body.includes('?')`, which leaks BOTH ways: it fails a correct check-in
 * that asks in the imperative ("tell me how the physio went") and passes an aside that asks nothing
 * ("Rest? Earned."). Since #346 makes asking the spine of the message (recap-prompt.ts:29-41 — "If
 * you don't ask it, the message has failed"), this is the most load-bearing check in the recap
 * suite, and a false failure here costs a paid generation and reads as a product regression.
 *
 * A body counts as asking when either:
 *  (a) some '?'-terminated segment is interrogative — a wh-word / auxiliary / "any…" / second
 *      person — or it names one of THIS scenario's open items, which credits the terse phrasing a
 *      friend actually texts ("Compost bins ordered?"); or
 *  (b) it invites a report back in the imperative ("let me know how it went"), a '?'-free ask.
 * A self-answered wh-shell is explicitly not an ask.
 *
 * Whether it asked about the RIGHT thing stays the rubric's job; this only pins THAT it asked.
 */
export const asksSomething = (): RecapCheck => (body, sc) => {
  const pass = detectAsk(body, sc.request.open)
  return {
    name: 'asks the user something (question or explicit invitation)',
    pass,
    ...(pass ? {} : { detail: body.slice(0, 160) }),
  }
}

function detectAsk(body: string, openItems: string[]): boolean {
  if (INVITATION.test(body)) return true
  const itemWords = openItemWords(openItems)
  for (const match of body.matchAll(QUESTION_SEGMENT)) {
    const segment = match[0]
    const after = body.slice((match.index ?? 0) + segment.length)
    if (WH_SHELL.test(segment.trim()) && SELF_ANSWER.test(after)) continue
    if (INTERROGATIVE.test(segment)) return true
    const lower = segment.toLowerCase()
    if (itemWords.some((w) => lower.includes(w))) return true
  }
  return false
}

export const scenarios: RecapScenario[] = [
  {
    kind: 'recap',
    id: 'recap-productive-day',
    title: 'Productive day: credits the two finished items AND asks about the open one',
    tags: ['recap', 'format', 'faithfulness', 'checkin'],
    request: {
      dayName: 'Tuesday',
      name: 'Sam',
      done: ['Write the quarterly report', 'Email the plumber back'],
      open: ['Prep slides for team sync'],
      activity: [
        { kind: 'completed', taskText: 'Write the quarterly report', detail: {} },
        { kind: 'created', taskText: 'Order new laptop charger', detail: {} },
      ],
      upcoming: ['Team sync slides — due tomorrow'],
      habitsKept: ['Morning run'],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      recapMentions('report'),
      // Not a bare 'slides' needle: "how's the team sync deck coming?" names the same open item
      // faithfully, and a one-spelling needle would fail a correct reply (same paraphrase class as
      // the 'tax' needle below).
      mentionsAnyOf('names the open slides item', ['slides', 'deck', 'sync', 'presentation']),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Two plan items finished, one still open ("Prep slides for team sync"). REQUIRED: the recap ' +
      'asks how the open slides went — a real question ("did they get started?"), not a reminder ' +
      'that they are due tomorrow — and credits the two finished items by name and warmly. The ' +
      'tomorrow heads-up and the habit nod are OPTIONAL trim: at most one small flourish, never ' +
      'piled on. A warm message that spends its whole budget celebrating and never asks about the ' +
      'slides is a FAIL however nice it sounds. Mentions ONLY items from the request.',
  },
  {
    kind: 'recap',
    id: 'recap-empty-day',
    title: 'Nothing-done day: names the open item and asks, no guilt, no reaching for praise',
    tags: ['recap', 'empty', 'faithfulness', 'tone', 'checkin'],
    request: {
      dayName: 'Wednesday',
      name: null,
      done: [],
      open: ['File quarterly taxes'],
      activity: [],
      upcoming: [],
      habitsKept: [],
    },
    checks: [
      recapSignoff(),
      recapMaxWords(120),
      recapNoHeaders(),
      // 'tax', not 'taxes': the item must be named, but "the quarterly tax filing" / "tax return"
      // are equally faithful namings and a plural-only needle would fail them.
      recapMentions('tax'),
      asksSomething(),
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Nothing finished and one thing open ("File quarterly taxes"). REQUIRED: name it and ask how ' +
      'it went, and make plain that a slow day is fine — "not today" and "I rested" should read as ' +
      'perfectly good answers. It must NOT scold, must NOT reach for something to praise (there is ' +
      'nothing to praise here), and must not invent accomplishments. A kind message that never ' +
      'asks about the taxes is a FAIL.',
  },
]
