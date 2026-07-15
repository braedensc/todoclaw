import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour is ONE section, played entirely over the DemoScene — no second leg over the user's own
// empty shell (that only bred redundancy). Eight panels, all pointing at the one example scene:
// welcome → board → three task kinds → Plan My Day (button + the plan it builds) → morning →
// evening → daily habits → the rest of the app. Everything the tour highlights lives ON the scene,
// so the walkthrough never jumps surfaces: the habits panel points at the REAL habits strip the
// scene mounts over seeded data, and the plan button + options chrome are look-only copies of the
// real controls (the originals are wired to real handlers in the shell this overlay covers).

/**
 * The demo tour — over the DemoScene. Targets ONLY the scene's own `demo-*` wrapper anchors: 'grid'
 * and 'matrix' also exist in the real shell underneath, and anchors resolve first-match-in-document.
 *
 * Every target exists on both breakpoints; two bodies are breakpoint-specific because the two
 * surfaces genuinely differ (ADR-0028), and `demoTour(isMobile)` swaps only the copy:
 *  - BOARD — desktop is the free-canvas grid (glow rings, ↻ / ❄️ badges), mobile is the 2×2
 *    quadrant overview (labels, counts, ⏰ badges, no grid). Teaching the grid's decoder ring to
 *    users who will never see a grid is worse than saying less.
 *  - THE REST OF THE APP — desktop's options are the header nav across the top; mobile has no
 *    header nav at all (bottom-bar tabs + "More"), and the scene mirrors that, so this step's copy
 *    must name the place the spotlight is actually sitting on.
 */
export function demoTour(isMobile: boolean): TourStep[] {
  return [
    {
      target: 'demo-board',
      title: 'Welcome to TodoClaw',
      body:
        'TodoClaw keeps everything you have to do in one place, sorted by how urgent and important ' +
        'it is — then plans a realistic day for you each morning and checks in each evening. ' +
        'Here’s a day already in motion.',
    },
    {
      target: 'demo-board',
      title: 'Sorted by what matters',
      body: isMobile
        ? 'Everything sorts into four boxes by how urgent and important it is, so what to do next ' +
          'is always obvious — “Do Now” is the box to clear first. The ⏰ badges flag what’s due; ' +
          'tap any box to open its list.'
        : 'Further right is more urgent, higher up is more important — so the top-right corner is ' +
          'always what to do next. Tasks heat up as they come due, then cool down and turn icy ❄️ ' +
          'once ignored too long. Repeating chores wear the ↻ arrow.',
    },
    {
      target: 'demo-board',
      title: 'Three kinds of task',
      body: 'Everything you add is one of three kinds:',
      bullets: [
        {
          lead: 'One-off',
          rest: 'something you do once (renew your passport, book a haircut).',
        },
        {
          lead: 'Recurring',
          rest: 'a chore that comes back on a schedule; marking it done just resets it (water the plants, pay rent).',
        },
        {
          lead: 'Ongoing',
          rest: 'a long project with no real deadline; it stays put while TodoClaw nudges you to chip away (learn Spanish, declutter the garage).',
        },
      ],
    },
    {
      target: 'demo-plan',
      title: 'One tap plans your day',
      body:
        'This ✦ Plan My Day button turns your whole board into a realistic day — one big rock, a ' +
        'few quick wins, and room for habits, never an overstuffed list. One tap builds the plan ' +
        'you see here.',
    },
    {
      target: 'demo-chat-morning',
      title: 'The plan comes to you',
      body:
        'With notifications on, every morning the day’s plan arrives by itself — on your device ' +
        'and in the app. No opening a to-do list to remember what matters.',
    },
    {
      target: 'demo-chat-evening',
      title: 'Evenings close the loop',
      body:
        'Each evening BabyClaw checks in. Reply in plain words — “1 and 3” — and he ticks them ' +
        'off for you.',
    },
    {
      target: 'demo-habits',
      title: 'Daily habits',
      body:
        'Small routines you repeat — stretch, meds, walk the dog. Build them once and they sit ' +
        'right above your board every day; tap the paw to check one off. They reset every morning.',
    },
    {
      target: 'demo-options',
      title: 'The rest of the app',
      // Name only what Settings actually holds: its tabs are Plan My Day / Notifications / AI /
      // Backups, plus the timezone picker and "Replay the tour". There is no reset-time control —
      // the daily reset is local midnight in your stored timezone, so the timezone IS the knob.
      body: isMobile
        ? 'The bar along the bottom is always there: BabyClaw’s chat, and Done for everything ' +
          'you’ve finished. Your habits and Settings — notifications, timezone, backups, and this ' +
          'tour — live under “More”. And AI is always optional; everything here works by hand too.'
        : 'Along the top: BabyClaw’s chat, your daily habits, Done for everything you’ve ' +
          'finished, and Settings — notifications, your timezone, backups, and this tour. And AI ' +
          'is always optional; everything here works by hand too.',
    },
  ]
}

/** The one-step "Show me where" spotlight for the setup guide's add-your-first-task step. */
export const ADD_TASK_SPOTLIGHT: TourStep[] = [
  {
    target: 'task-input',
    title: 'Add your first task here',
    body:
      'Tell BabyClaw in plain English — “dentist Friday 2pm, important” — and he’ll add and ' +
      'place it. Or switch to Manual to type it yourself and drag it onto the grid.',
  },
]
