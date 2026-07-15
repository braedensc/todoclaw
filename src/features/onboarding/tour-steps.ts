import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour is ONE section, played entirely over the DemoScene — no second leg over the user's own
// empty shell (that only bred redundancy). Nine panels, all pointing at the one example scene:
// welcome → board → three task kinds → Plan My Day (button + the plan it builds) → morning →
// evening → chat-runs-it-all → daily habits → settings. Everything the tour highlights (the plan
// button, the habits card, the settings card) is example scenery ON the scene, so the walkthrough
// never jumps surfaces.

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
        'Todoclaw is an AI-powered planner. Everything you have to do lands in one place, sorted ' +
        'by how urgent and important it is — and BabyClaw, your AI pup, plans a realistic day ' +
        'each morning and checks in each evening. Here’s a day already in motion.',
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
        'Small routines you repeat — stretch, meds, walk the dog. Build them once and they show up ' +
        'on your home screen to paw-check off each day; they reset every morning.',
    },
    {
      target: 'demo-settings',
      title: 'Settings and the rest',
      body:
        'Your daily reset time, notifications, timezone, backups, and this tour all live in ' +
        'Settings. And you hold the leash: everything BabyClaw does with AI, you can also do by ' +
        'hand — the whole planner works without him.',
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
