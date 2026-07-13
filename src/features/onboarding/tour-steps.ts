import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The full tour runs in TWO ACTS (App.tsx owns the sequencing):
//   Act 1 — DEMO_TOUR over the DemoScene (a filled example board + the plan + both check-ins,
//           all real components on fake data), so a new user SEES the whole system at play;
//   Act 2 — DESKTOP_TOUR / MOBILE_TOUR over the user's own (empty) shell: "you just saw this —
//           here's where it lives". Kept deliberately short (the demo already did the showing);
//           demo 4 + act-two 5 (desktop) / 4 (mobile) steps keeps the whole thing under ~10 taps.

/**
 * Act 1 — over the DemoScene. Targets ONLY the scene's own `demo-*` wrapper anchors: 'grid' and
 * 'matrix' also exist in the real shell underneath, and anchors resolve first-match-in-document.
 * One script serves both breakpoints (every target exists on both).
 */
export const DEMO_TOUR: TourStep[] = [
  {
    target: 'demo-board',
    title: 'A board in full swing',
    body:
      'This is an example — not your tasks. Everything you have to do lives in one place, ' +
      'sorted by how urgent and important it is, so what to do next is always obvious. ' +
      'Deadlines glow, repeating chores wear ↻, and anything ignored too long turns icy ❄️.',
  },
  {
    target: 'demo-plan',
    title: 'One tap plans the day',
    body:
      'Plan My Day looked at everything on this board and picked a realistic day: one big ' +
      'rock, a few quick wins, and room for habits — never an overstuffed list.',
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

/** Act 2, desktop: the user's own shell — grid → Task Manager → Plan My Day → inbox → habits. */
export const DESKTOP_TOUR: TourStep[] = [
  {
    target: 'grid',
    title: 'This board is yours',
    body:
      'Same map as the example: further right = more urgent, higher up = more important — so ' +
      'the top-right corner is always “do now”. It starts empty; add a task or two and drag ' +
      'them around as things change.',
  },
  {
    target: 'task-input',
    title: 'Add tasks by just saying them',
    body:
      'Tell BabyClaw — your AI helper — things like “dentist Friday 2pm, remind me an hour ' +
      'before” and he handles the rest. Prefer full control? Switch to Manual. Either way, ' +
      'every task is one of three kinds:',
    bullets: [
      {
        lead: 'One-off task',
        rest: 'something you do once (renew your passport, book a haircut).',
      },
      {
        lead: 'Recurring',
        rest: 'a chore that comes back on a schedule; marking it done just resets it (water the plants, pay rent).',
      },
      {
        lead: 'Ongoing',
        rest: 'a long project with no real deadline; it stays put while todoclaw nudges you to chip away (learn Spanish, declutter the garage).',
      },
    ],
  },
  {
    target: 'plan',
    title: 'One tap plans your day',
    body:
      'This ✦ pill builds the plan you just saw in the example — from your real tasks, habits, ' +
      'and schedule. Add a task or two first, then try it.',
  },
  {
    target: 'inbox',
    title: 'Check-ins land here',
    body:
      'The morning plan and the evening check-in you just watched arrive on their own — on ' +
      'your device with notifications on, and always here in the inbox.',
  },
  {
    target: 'habits',
    title: 'Daily habits',
    body:
      'Small routines you repeat — stretch, meds, walk the dog. Create and organize them ' +
      'here; once you have some, they appear on your home screen where you paw-check them ' +
      'off each day. They reset every morning.',
  },
]

/** Act 2, mobile: quadrant overview → ➕ add → Chat → More. */
export const MOBILE_TOUR: TourStep[] = [
  {
    target: 'matrix',
    title: 'These four boxes are yours',
    body:
      'Tasks sort by how urgent and important they are — “Do Now” is the box to clear first. ' +
      'Tap any box to open its list. It starts empty; your first task lands in the right box ' +
      'automatically.',
  },
  {
    target: 'nav-add',
    title: 'Add a task here',
    body:
      'Tap ➕, describe the task, and pick how urgent + important it feels. Every task is one ' +
      'of three kinds:',
    bullets: [
      {
        lead: 'One-off task',
        rest: 'something you do once (renew your passport, book a haircut).',
      },
      {
        lead: 'Recurring',
        rest: 'a chore that comes back on a schedule; marking it done just resets it (water the plants, pay rent).',
      },
      {
        lead: 'Ongoing',
        rest: 'a long project with no real deadline; todoclaw nudges you to chip away (learn Spanish, declutter the garage).',
      },
    ],
  },
  {
    target: 'nav-chat',
    title: 'Or just tell BabyClaw',
    body:
      'Chat is BabyClaw, your AI helper — say “add vet appointment Friday 3pm, remind me an ' +
      'hour before” and it’s done. He can also move, finish, and clean up tasks for you.',
  },
  {
    target: 'nav-more',
    title: 'Habits, inbox, and everything else',
    body:
      'Create daily habits here — small routines like stretch or meds to paw-check off each ' +
      'day. Your inbox (where the morning plan and evening check-in land), Settings, and ' +
      'Backups live in More too.',
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
