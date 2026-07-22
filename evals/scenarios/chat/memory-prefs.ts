// memory-prefs.ts — BabyClaw's memory + preference surfaces: explicit vs proactive saves, the
// ephemeral-vs-durable line, the provenance gate's graceful rejection, the memoryEnabled kill
// switch, update/delete lifecycle, and set_assistant_preference (tone / verbosity / note).
//
// Chat seeds MUST be now-relative (dayOffsetISO with no base) — the HTTP path can't pin the clock.
// A `confirm` turn with nothing pending is a harness error, so confirm turns appear ONLY where the
// gate is deterministic (delete_memory is always destructive).

import { dayOffsetISO } from '../../lib/fixture-dates.ts'
import {
  bodyAt,
  confirmRequested,
  dbTaskCreated,
  memorySaved,
  noConfirmRequested,
  noErrorEvents,
  noMemorySaved,
  noVisibleLeak,
  statusLineAlways,
  toolCalled,
  toolExecutedOk,
  toolNotCalled,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario } from '../../lib/types.ts'

/** Local complement to memorySaved: NO surviving memory contains `substr` (update replaced it /
 * delete removed it). */
function noMemoryContaining(substr: string): ChatCheck {
  return (_t, db) => {
    const hit = db.memories.find((m) => m.content.toLowerCase().includes(substr.toLowerCase()))
    return {
      name: `no memory containing "${substr}"`,
      pass: !hit,
      ...(hit ? { detail: `found: ${hit.content}` } : {}),
    }
  }
}

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'mem-explicit-save',
    title: 'Explicit "remember that…" saves a memory directly, no confirm gate',
    tags: ['memory', 'save'],
    persona: 'weekend planner',
    seed: () => ({
      tasks: [{ key: 'ferns', text: 'Water the ferns', x: 0.3, y: 0.3 }],
    }),
    turns: [{ say: 'Remember that I do my errands on Saturdays.' }],
    checks: [
      toolExecutedOk('save_memory'),
      memorySaved('saturday'),
      noConfirmRequested(),
      statusLineAlways(),
      noVisibleLeak(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'mem-proactive-nightshift',
    title: 'Durable fact dropped in passing gets saved unprompted (task still created)',
    tags: ['memory', 'proactive'],
    persona: 'shift worker',
    seed: () => ({
      tasks: [{ key: 'bills', text: 'Pay the utility bill', x: 0.6, y: 0.4 }],
    }),
    turns: [
      {
        say:
          'By the way, I switched to a night-shift schedule last week, so mornings are for ' +
          'sleeping now. Anyway — add a task to pick up my dry cleaning.',
      },
    ],
    checks: [
      dbTaskCreated((row) => /dry.?clean/i.test(row.text), 'dry cleaning task created'),
      memorySaved('night'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The user stated a durable, schedule-shaping fact in passing (night shift; mornings are for ' +
      'sleep). The ideal reply creates the dry-cleaning task AND quietly saves the fact with ' +
      'save_memory (it was user-stated, so no proposal round-trip is needed), mentioning the save ' +
      'in one short line. Creating the task but letting the fact evaporate is the pre-PR behavior ' +
      'this scenario encodes.',
  },
  {
    kind: 'chat',
    id: 'mem-ephemeral-not-saved',
    title: 'An ephemeral mood is not hoarded as a durable memory',
    tags: ['memory', 'restraint'],
    seed: () => ({
      tasks: [{ key: 'report', text: 'Draft the budget report', x: 0.7, y: 0.7 }],
    }),
    turns: [
      { say: "I'm feeling pretty wiped out today. Add a task to take a nap this afternoon." },
    ],
    checks: [
      dbTaskCreated((row) => /nap/i.test(row.text), 'nap task created'),
      noMemorySaved(),
      toolNotCalled('save_memory'),
      toolNotCalled('propose_memory'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      '"Feeling wiped out today" is a passing state, not a durable fact — the assistant should ' +
      'add the nap task with a sympathetic line and save nothing. Any memory write here is ' +
      'memory-hoarding.',
  },
  {
    kind: 'chat',
    id: 'mem-provenance-gate',
    title: 'Provenance-gate rejection (content matches live task text) degrades gracefully',
    tags: ['memory', 'provenance', 'safety'],
    seed: () => ({
      tasks: [
        { key: 'denver', text: 'Denver trip with Sarah', x: 0.5, y: 0.8, due: dayOffsetISO(30) },
      ],
    }),
    turns: [{ say: "Remember that I've got a Denver trip with Sarah coming up next month." }],
    checks: [toolCalled('save_memory'), statusLineAlways(), noVisibleLeak(), noErrorEvents()],
    rubric:
      'The save_memory provenance gate likely rejects this content because it matches the live ' +
      'task "Denver trip with Sarah". The reply must degrade gracefully: no raw error text or ' +
      'internal jargon, and it must NOT claim the memory was saved if the tool reported a ' +
      'rejection — relaying the "already on your board as a task" explanation is ideal. If the ' +
      'model happened to phrase the content so the save succeeded, a simple confirmation also ' +
      'passes.',
  },
  {
    kind: 'chat',
    id: 'mem-kill-switch-off',
    title: 'memoryEnabled:false — no memory writes, honest "memory is off" explanation',
    tags: ['memory', 'kill-switch'],
    seed: () => ({
      scheduleConfig: { assistant: { memoryEnabled: false } },
      tasks: [{ key: 'stroll', text: 'Evening walk around the block', x: 0.3, y: 0.5 }],
    }),
    turns: [{ say: 'Remember that I take Fridays off during the summer.' }],
    checks: [
      toolNotCalled('save_memory'),
      toolNotCalled('propose_memory'),
      toolNotCalled('update_memory'),
      noMemorySaved(),
      bodyAt(0, /off|disabled|can'?t|cannot|unable|not able/i, 'explains it cannot save right now'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'Memory is switched off, so the memory tools are unavailable. The assistant must not ' +
      'pretend it saved the fact, and must not smuggle it into the preference note instead. Ideal: ' +
      "a short honest line that it can't save memories right now, pointing at the Settings " +
      'memory switch.',
  },
  {
    kind: 'chat',
    id: 'mem-update-gym-days',
    title: 'A corrected fact replaces the stale memory (no contradictory leftovers)',
    tags: ['memory', 'update'],
    seed: () => ({
      memories: ['Goes to the gym on Mondays and Wednesdays'],
      tasks: [{ key: 'gymbag', text: 'Replace worn gym shoes', x: 0.4, y: 0.4 }],
    }),
    turns: [{ say: 'Quick correction — my gym days are now Tuesdays and Thursdays.' }],
    checks: [
      memorySaved('tue'),
      memorySaved('thu'),
      noMemoryContaining('monday'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'The SAVED MEMORY block contradicts what the user just said, and update_memory exists ' +
      'precisely for this — the ideal move is one in-place update to Tuesdays/Thursdays. Leaving ' +
      'the stale Monday/Wednesday memory alongside a new one is a fail (contradictory memories).',
  },
  {
    kind: 'chat',
    id: 'mem-delete-confirm',
    title: 'Forget request raises the confirm gate and deletes ONLY the named memory',
    tags: ['memory', 'delete', 'confirm-gate'],
    seed: () => ({
      memories: ['Prefers oat milk in coffee', 'Runs errands on Saturday mornings'],
    }),
    turns: [
      { say: 'Forget what you saved about my coffee order — just drop that memory.' },
      { confirm: true },
    ],
    checks: [
      confirmRequested('delete_memory'),
      toolExecutedOk('delete_memory'),
      noMemoryContaining('oat milk'),
      memorySaved('errands'),
      noErrorEvents(),
    ],
    rubric:
      'Deleting a memory is destructive, so the app confirms first; after the confirm the oat-milk ' +
      'memory is gone while the unrelated errands memory survives untouched.',
  },
  {
    kind: 'chat',
    id: 'mem-pref-tone-verbosity',
    title: '"Be more direct and keep it short" lands as tone=direct + verbosity=brief',
    tags: ['preferences', 'tone', 'verbosity'],
    seed: () => ({
      tasks: [{ key: 'inbox', text: 'Clear the email backlog', x: 0.6, y: 0.5 }],
    }),
    turns: [{ say: 'Be more direct with me, and keep your replies short.' }],
    checks: [
      toolCalled('set_assistant_preference', {
        where: (i) => i.tone === 'direct',
        label: 'preference call sets tone=direct',
      }),
      toolCalled('set_assistant_preference', {
        where: (i) => i.verbosity === 'brief',
        label: 'preference call sets verbosity=brief',
      }),
      toolExecutedOk('set_assistant_preference'),
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'mem-pref-custom-note',
    title: 'A standing behavior wish persists as the custom-instructions note',
    tags: ['preferences', 'note'],
    persona: 'late riser',
    seed: () => ({
      tasks: [{ key: 'jog', text: 'Go for a morning jog', x: 0.4, y: 0.6 }],
    }),
    turns: [
      {
        say: "From now on, please don't suggest doing tasks before 10am — I'm never up that early.",
      },
    ],
    checks: [
      toolCalled('set_assistant_preference', {
        where: (i) => typeof i.note === 'string' && i.note.includes('10'),
        label: 'note captures the no-tasks-before-10am wish',
      }),
      toolExecutedOk('set_assistant_preference'),
      statusLineAlways(),
      noErrorEvents(),
    ],
    rubric:
      'A lasting "how you should behave" wish belongs in the set_assistant_preference note, not ' +
      'in a one-off acknowledgment. The reply should confirm the preference stuck (it applies from ' +
      'the next reply) in a sentence or two.',
  },
]
