// recap-core.ts — evening check-in fundamentals: format contract (sign-off, length), and the
// no-invention rule probed with DECOYS — plausible task names deliberately absent from the
// request; if the recap mentions one, the model invented.

import {
  recapMaxWords,
  recapMentions,
  recapMentionsNone,
  recapNoHeaders,
  recapSignoff,
} from '../../lib/checks.ts'
import type { RecapScenario } from '../../lib/types.ts'

const DECOYS = ['laundry', 'dentist', 'groceries', 'gym session']

export const scenarios: RecapScenario[] = [
  {
    kind: 'recap',
    id: 'recap-productive-day',
    title: 'Productive day: warm, concrete, references only given items',
    tags: ['recap', 'format', 'faithfulness'],
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
      recapMentionsNone(DECOYS),
    ],
    rubric:
      'Warm second-person recap: celebrates the two finished items and the kept habit, gently ' +
      'notes the open slides + tomorrow heads-up. Mentions ONLY items from the request.',
  },
  {
    kind: 'recap',
    id: 'recap-empty-day',
    title: 'Nothing-done day: kind, zero invention, no guilt',
    tags: ['recap', 'empty', 'faithfulness', 'tone'],
    request: {
      dayName: 'Wednesday',
      name: null,
      done: [],
      open: ['File quarterly taxes'],
      activity: [],
      upcoming: [],
      habitsKept: [],
    },
    checks: [recapSignoff(), recapMaxWords(120), recapNoHeaders(), recapMentionsNone(DECOYS)],
    rubric:
      'A day with nothing completed: the recap must stay kind (no scolding), must not invent ' +
      'accomplishments, and may gently point at the one open item as tomorrow’s start.',
  },
]
