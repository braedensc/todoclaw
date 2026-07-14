import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour is ONE section, played entirely over the DemoScene (a filled example board + the plan +
// both check-ins, all real components on fake data). It opens with a plain-words "what this is"
// welcome, explains the board (and the three kinds of task you can add) on the live example, then
// walks the plan and the morning/evening check-ins. No second act over the user's own empty shell:
// the example already showed the whole loop, and repeating it there only bred redundancy.

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
