import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour is ONE section: DemoScene mounts inline in the real shell (below the real header, in
// place of the real board/plan/reminders it stands in for — see DemoScene's own comment), so the
// real chrome around it is never hidden. Nine panels: welcome → board → three task kinds →
// Plan My Day (button + the plan it builds) → morning → evening → chat-runs-it-all → daily habits
// → the rest of the app. The first eight point at the example scene's own `demo-*` anchors (the
// board, the look-only plan block, the two chat cards, the real habits strip mounted there); the
// LAST one points at the REAL Account nav / bottom bar sitting right there in the shell — no
// look-alike copy.

/**
 * The demo tour. Steps 1–8 target the DemoScene's own `demo-*` wrapper anchors: 'grid' and 'matrix'
 * also exist in the real shell underneath, and anchors resolve first-match-in-document. The closing
 * step targets `options`, the REAL Account nav (desktop header) / bottom bar (mobile) — DemoScene
 * doesn't cover them, so there's nothing to fake.
 *
 * Every target exists on both breakpoints; two bodies are breakpoint-specific because the two
 * surfaces genuinely differ (ADR-0028), and `demoTour(isMobile)` swaps only the copy:
 *  - BOARD — desktop is the free-canvas grid (glow rings, ↻ / ❄️ badges), mobile is the 2×2
 *    quadrant overview (labels, counts, ⏰ badges, no grid). Teaching the grid's decoder ring to
 *    users who will never see a grid is worse than saying less.
 *  - THE REST OF THE APP — desktop's options are the header nav across the top; mobile has no
 *    header nav at all (bottom-bar tabs + "More"), so this step's copy must name the place the
 *    spotlight is actually sitting on.
 */
export function demoTour(isMobile: boolean): TourStep[] {
  return [
    {
      target: 'demo-board',
      title: 'Welcome to TodoClaw',
      body:
        'TodoClaw is an AI-powered planner. Everything you have to do lands in one place, sorted ' +
        'by how urgent and important it is — and BabyClaw, your AI pup, plans a realistic day ' +
        'each morning and checks in each evening. Here’s a day already in motion.',
    },
    {
      target: 'demo-board',
      title: 'Sorted by what matters',
      body: isMobile
        ? 'You sort each task into one of four boxes by how urgent and important it is — tap ' +
          '“Move to quadrant” to place it. That placement is what sets its priority, so what to ' +
          'do next is always clear: “Do Now” is the box to clear first. The ⏰ badges flag what’s ' +
          'due; tap any box to open its list.'
        : 'You place each task yourself — drag it right for more urgent, up for more important. ' +
          'Where you drop it sets its priority, so the top-right corner is always what to do next. ' +
          'Tasks heat up as they come due, then cool to icy ❄️ once ignored too long; repeating ' +
          'chores wear the ↻ arrow.',
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
        'This ✦ Plan My Day button turns your whole board into a realistic day. BabyClaw reads ' +
        'where you placed each task and the details — due dates, recurring chores, ongoing ' +
        'projects — to pick one big rock, a few quick wins, and room for habits, never an ' +
        'overstuffed list. One tap builds the plan you see here.',
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
        'off for you: each green ✓ receipt is him really updating your board.',
    },
    {
      target: 'demo-chat-evening',
      title: 'Chat runs the whole app',
      body:
        'Check-ins are just the start: tell BabyClaw “add dentist Friday 2pm,” “push the invoice ' +
        'to Monday,” or “what’s overdue?” — anytime, in plain words. He does it and stamps a ' +
        'receipt, like the ones here.',
    },
    {
      target: 'demo-habits',
      title: 'Daily habits',
      body:
        'Small routines you repeat — stretch, meds, walk the dog. Build them once and they sit ' +
        'right above your board every day; tap the paw to check one off. They reset every morning.',
    },
    {
      target: 'options',
      title: 'The rest of the app',
      // Name only what Settings actually holds: its tabs are Plan My Day / Notifications / AI /
      // Backups, plus the timezone picker and "Replay the tour". There is no reset-time control —
      // the daily reset is local midnight in your stored timezone, so the timezone IS the knob.
      body: isMobile
        ? 'The bar along the bottom is always there: BabyClaw’s chat, and Done for everything ' +
          'you’ve finished. Your habits and Settings — notifications, timezone, backups, and this ' +
          'tour — live under “More”. And you hold the leash: everything BabyClaw does with AI, ' +
          'you can also do by hand — the whole planner works without him.'
        : 'Along the top: BabyClaw’s chat, your daily habits, Done for everything you’ve ' +
          'finished, and Settings — notifications, your timezone, backups, and this tour. And ' +
          'you hold the leash: everything BabyClaw does with AI, you can also do by hand — the ' +
          'whole planner works without him.',
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
