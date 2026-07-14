import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour runs in TWO legs, sequenced by App.tsx:
//   Leg 1 — DEMO_TOUR over the DemoScene (a filled example board + the plan + both check-ins, all
//           real components on fake data): a plain-words welcome, the board (and the three kinds of
//           task) on the live example, then the plan and the morning/evening check-ins.
//   Leg 2 — SHELL_TOUR over the user's OWN shell: "you just saw it work — here's where each piece
//           lives in your app." Points at the real Add-a-task box, the Plan My Day button, the
//           inbox, habits, and settings. It deliberately does NOT re-explain the board or re-list
//           the task kinds — leg 1 already did, and saying it twice is the redundancy we avoid.

/**
 * The demo tour — over the DemoScene. Targets ONLY the scene's own `demo-*` wrapper anchors: 'grid'
 * and 'matrix' also exist in the real shell underneath, and anchors resolve first-match-in-document.
 * Every target exists on both breakpoints, but the BOARD step's copy is breakpoint-specific: the
 * desktop scene is the free-canvas grid (glow rings, ↻ / ❄️ badges), the mobile scene is the 2×2
 * quadrant overview (labels, counts, ⏰ badges — no grid, ADR-0028), so `demoTour(isMobile)` swaps
 * that one body rather than teaching a decoder ring for a UI half the users never see.
 */
export function demoTour(isMobile: boolean): TourStep[] {
  return [
    {
      target: 'demo-board',
      title: 'Welcome to Todoclaw',
      body:
        'Todoclaw keeps everything you have to do in one place, sorted by how urgent and important ' +
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
          rest: 'a long project with no real deadline; it stays put while Todoclaw nudges you to chip away (learn Spanish, declutter the garage).',
        },
      ],
    },
    {
      target: 'demo-plan',
      title: 'One tap plans your day',
      body:
        'Plan My Day looks at your whole board and picks a realistic day — one big rock, a few ' +
        'quick wins, and room for habits — never an overstuffed list. This is the plan it built ' +
        'from the example board.',
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
        'off for you. And AI is always optional: everything here also works by hand.',
    },
  ]
}

/**
 * Leg 2, desktop: the user's own shell — Add-a-task → Plan My Day button → inbox → habits →
 * settings. No board step: leg 1's example already taught the urgent × important map, so pointing
 * at the (empty) real grid again would only repeat it.
 */
export const SHELL_TOUR_DESKTOP: TourStep[] = [
  {
    target: 'task-input',
    title: 'Add tasks by just saying them',
    body:
      'Tell BabyClaw — your AI helper — things like “dentist Friday 2pm, remind me an hour ' +
      'before” and he adds and places it. Prefer full control? Switch to Manual and drop it on ' +
      'the grid yourself.',
  },
  {
    target: 'plan',
    title: 'Your Plan My Day button',
    body:
      'This ✦ pill builds the plan you just saw in the example — from your real tasks, habits, ' +
      'and schedule. With a task or two on the board, give it a tap.',
  },
  {
    target: 'inbox',
    title: 'Check-ins land here',
    body:
      'The morning plan and the evening check-in you just watched arrive on their own — on your ' +
      'device with notifications on, and always here in the inbox.',
  },
  {
    target: 'habits',
    title: 'Daily habits',
    body:
      'Small routines you repeat — stretch, meds, walk the dog. Create and organize them here; ' +
      'once you have some, they appear on your home screen where you paw-check them off each day. ' +
      'They reset every morning.',
  },
  {
    target: 'settings',
    title: 'Settings and the rest',
    body:
      'Your daily reset time, notifications, timezone, backups, and this tour all live in ' +
      'Settings — tweak anything, anytime.',
  },
]

/** Leg 2, mobile: ➕ add → Chat → More (habits, inbox, settings all live in the More sheet). */
export const SHELL_TOUR_MOBILE: TourStep[] = [
  {
    target: 'nav-add',
    title: 'Add a task here',
    body:
      'Tap ➕, describe the task, and pick how urgent + important it feels — it lands in the ' +
      'right box automatically.',
  },
  {
    target: 'nav-chat',
    title: 'Or just tell BabyClaw',
    body:
      'Chat is BabyClaw, your AI helper — say “add vet appointment Friday 3pm, remind me an hour ' +
      'before” and it’s done. He can also move, finish, and clean up tasks for you.',
  },
  {
    target: 'nav-more',
    title: 'Habits, inbox, and everything else',
    body:
      'Daily habits, your inbox (where the morning plan and evening check-in land), Settings, and ' +
      'Backups all live in More.',
  },
]

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
