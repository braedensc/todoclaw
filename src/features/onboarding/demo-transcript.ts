// The demo tour's canned "example day" — the plan card and the morning/evening check-in
// transcripts the DemoScene plays. DEPENDENCY-FREE ON PURPOSE: this module is imported both by
// the React scene (src) and by a Deno drift test (supabase/functions/_shared/demo-transcript.test.ts)
// that regenerates DEMO_MORNING / DEMO_RECAP through the REAL dispatch builders
// (buildMorningFromPlan / buildRecapMessage) and asserts they still equal the strings below — so
// the demo can never quietly drift from what the dispatcher actually sends. If that test fails,
// re-run the builders over these fixtures and paste the new output here.
//
// The dates inside DEMO_MORNING_INPUTS are FIXED (2026-07-13, a Monday): they exist only to make
// the builder output deterministic. Nothing date-shaped appears in the rendered text (only clock
// times), so the transcript never looks stale on screen. The live demo BOARD (demo-board.ts) is a
// separate fixture authored relative to the real "today".

/** Mirrors src/types/plan.ts DayPlan structurally (no import — see header). */
export interface DemoPlanRock {
  task: string
  why: string
  duration: string
  when: 'morning' | 'lunch' | 'afternoon' | 'evening'
}
export interface DemoPlan {
  headline: string
  availableTime: string
  bigRock: DemoPlanRock | null
  smallRocks: DemoPlanRock[]
  habitNote: string
}

/** The example plan shown in the real PlanBox. Task names match the demo board (demo-board.ts). */
export const DEMO_PLAN: DemoPlan = {
  headline: 'Invoice first — then three quick wins to clear the deck.',
  availableTime: 'About 5 focused hours today',
  bigRock: {
    task: 'Send the invoice',
    why: 'It unblocks getting paid, and it’s due today.',
    duration: '45 min',
    when: 'morning',
  },
  smallRocks: [
    {
      task: 'Book the dentist',
      why: 'Two minutes on the phone gets it off the board.',
      duration: '5 min',
      when: 'lunch',
    },
    {
      task: 'Water the plants',
      why: 'Its three-day cycle comes around today.',
      duration: '10 min',
      when: 'afternoon',
    },
    {
      task: 'Book the campsite',
      why: 'The good spots for the camping trip go fast.',
      duration: '20 min',
      when: 'evening',
    },
  ],
  habitNote: 'Stretch and the dog walk slot in nicely after lunch.',
}

/** Fixed reference day for the transcript fixtures (a Monday — dayName below must agree). */
export const DEMO_TRANSCRIPT_DATE = '2026-07-13'
export const DEMO_TRANSCRIPT_DAY = 'Monday'
export const DEMO_TRANSCRIPT_TZ = 'America/New_York'

// Structurally a DispatchInputs (supabase/functions/_shared/dispatch.ts) — the morning snapshot:
// nothing done yet. No notifications.name on purpose: the demo greeting stays generic
// ("Good morning! ☀️") instead of inventing a person.
export const DEMO_MORNING_INPUTS = {
  config: { notifications: {} },
  tasks: [
    {
      id: 'demo-invoice',
      text: 'Send the invoice',
      x: 0.82,
      y: 0.78,
      due: DEMO_TRANSCRIPT_DATE,
      due_time: null,
      size: 'M',
      staged: false,
      recurring: null,
    },
    {
      id: 'demo-vet',
      text: 'Call the vet',
      x: 0.88,
      y: 0.6,
      due: DEMO_TRANSCRIPT_DATE,
      due_time: '16:30:00',
      size: null,
      staged: false,
      recurring: null,
    },
    {
      id: 'demo-dentist',
      text: 'Book the dentist',
      x: 0.62,
      y: 0.35,
      due: '2026-07-15',
      due_time: null,
      size: null,
      staged: false,
      recurring: null,
    },
    {
      id: 'demo-plants',
      text: 'Water the plants',
      x: 0.45,
      y: 0.3,
      due: null,
      due_time: null,
      size: null,
      staged: false,
      recurring: { frequencyDays: 3, lastDoneAt: '2026-07-10T14:00:00Z', doneCount: 12 },
    },
    {
      id: 'demo-campsite',
      text: 'Book the campsite',
      x: 0.37,
      y: 0.7,
      due: '2026-07-18',
      due_time: null,
      size: null,
      staged: false,
      recurring: null,
    },
  ],
  habits: [
    { id: 'demo-h1', text: 'Stretch 10 minutes', active: true },
    { id: 'demo-h2', text: 'Walk the dog', active: true },
  ],
  done: {} as Record<string, boolean>,
  habit_done: {} as Record<string, boolean>,
  plan: DEMO_PLAN,
}

// The evening snapshot: by check-in time the big rock got done during the day, so the recap
// acknowledges it (✓ crossed off) and lists the three remaining plan items.
export const DEMO_EVENING_INPUTS = {
  ...DEMO_MORNING_INPUTS,
  done: { 'demo-invoice': true } as Record<string, boolean>,
}

// ---------------------------------------------------------------------------------------------
// The canned check-in texts. GENERATED, not hand-written: exactly
//   buildMorningFromPlan(DEMO_PLAN, DEMO_MORNING_INPUTS, DEMO_TRANSCRIPT_DATE) and
//   buildRecapMessage(DEMO_EVENING_INPUTS, { dayName, timeZone, localDate })
// — the Deno drift test re-runs those builders and diffs against these constants.
// In-app, a proactive message opens in chat as `${title}\n\n${body}` (App.tsx seed effect).
// ---------------------------------------------------------------------------------------------

export const DEMO_MORNING = {
  title: 'Good morning! ☀️',
  body:
    'Invoice first — then three quick wins to clear the deck.\n\n' +
    '⏰ TODAY\n• 4:30 PM — Call the vet\n\n' +
    '🪨 BIG ROCK\n• Send the invoice (45 min)\n\n' +
    '⚡ QUICK WINS\n• Book the dentist (5 min)\n• Water the plants (10 min)\n• Book the campsite (20 min)\n\n' +
    '💪 HABITS\n• Stretch 10 minutes\n• Walk the dog\n\n' +
    '— BabyClaw 🐾',
}

export const DEMO_RECAP = {
  title: 'Wrapping up Monday 👋',
  body:
    'Nice work today — already crossed off:\n✓ Send the invoice\n\n' +
    "Still open from this morning's plan:\n" +
    '1. Book the dentist\n2. Water the plants\n3. Book the campsite\n\n' +
    "Reply with the numbers or names and I'll mark them done. No worries if that's where today ends 🙂\n\n" +
    '— BabyClaw 🐾',
}

// The scripted evening exchange after the recap: the user replies in plain words, BabyClaw marks
// the named items done (the ✓ notes use complete_task's REAL summary wording — tasks.ts) and
// wraps up. Only these three strings are invented; everything above is builder output.
export const DEMO_EVENING_REPLY = '1 and 3 — and I took the dog on the long loop 🐕'
export const DEMO_EVENING_TOOL_NOTES = [
  'Marked "Book the dentist" done for today.',
  'Marked "Book the campsite" done for today.',
]
export const DEMO_EVENING_CLOSE =
  'Nice — two more knocked out 🎉 “Water the plants” will be waiting tomorrow. Enjoy your evening!'
