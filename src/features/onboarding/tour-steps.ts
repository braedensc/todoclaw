import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.
//
// The tour is ONE section. It OPENS at the top of the app (`app-top`, the real masthead) so the
// first thing a first-run user sees is the app itself; DemoScene then mounts inline below that
// (in place of the real board/plan/reminders it stands in for — see DemoScene's own comment), so
// the real chrome around it is never hidden. The middle panels point at the example scene's own
// `demo-*` anchors; the LAST one points at the REAL Account nav / bottom bar sitting right there
// in the shell — no look-alike copy.
//
// STEP ORDER MUST MATCH DemoScene's section order — the overlay scrolls each anchor into view, so
// a mismatch scrolls the page backwards mid-tour.

/**
 * The demo tour. The middle steps target the DemoScene's own `demo-*` wrapper anchors ('grid' and
 * 'matrix' also exist in the real shell underneath, hence the `demo-` prefix — anchors resolve
 * first-match-in-document). The opening step targets `app-top` (the real masthead) and the closing
 * one `options`, the REAL Account nav (desktop header) / bottom bar (mobile) — DemoScene doesn't
 * cover either, so there's nothing to fake.
 *
 * `demoTour(isMobile)` swaps what genuinely differs between the two surfaces (ADR-0028):
 *  - THE GRID — the same board, reached differently: it's the desktop home page, and on a phone
 *    it's Grid view (the ⌐ Grid pill / More → Grid view).
 *  - THE QUICK OVERVIEW — a phone-only extra step for MobileMatrix, the surface the mobile shell
 *    actually opens on. Absent on desktop, which has no such view.
 *  - BOTTOM-BAR CALL-OUTS (`also`) — a phone learns WHERE a surface lives, so the add and chat
 *    panels also ring their tab in the bottom bar. Desktop's equivalents sit in the header nav the
 *    closing panel covers. The closing panel itself needs none: it spotlights the whole bar.
 *  - THE REST OF THE APP — desktop's options are the header nav across the top; mobile has no
 *    header nav at all (bottom-bar tabs + "More"), so this step's copy must name the place the
 *    spotlight is actually sitting on.
 */
export function demoTour(isMobile: boolean): TourStep[] {
  return [
    {
      target: 'app-top',
      title: 'Welcome to TodoClaw',
      body:
        'TodoClaw is an AI-powered planner. Everything you have to do lands in one place, sorted ' +
        'by how urgent and important it is — and BabyClaw, your AI pup, plans a realistic day ' +
        'each morning and checks in each evening. Below is a day already in motion.',
    },
    {
      target: 'demo-grid',
      title: 'Sorted by what matters',
      body: isMobile
        ? 'This is your grid — two dials, urgent (→) and important (↑). You place each task ' +
          'yourself: press and hold a chip to move it, or use ⇢ Move to tap where it goes. Where ' +
          'it sits IS its priority, so the top-right corner is always what to do next. Open it any ' +
          'time with the ▦ Grid button.'
        : 'You place each task yourself — drag it right for more urgent, up for more important. ' +
          'Where you drop it sets its priority, so the top-right corner is always what to do next. ' +
          'Tasks heat up as they come due, then cool to icy ❄️ once ignored too long; repeating ' +
          'chores wear the ↻ arrow.',
    },
    // Phone only: the everyday surface, introduced as the quick way to read the same board.
    ...(isMobile
      ? [
          {
            target: 'demo-matrix',
            title: 'Or the quick overview',
            body:
              'Day to day your phone opens on this instead — the same four corners of the grid as ' +
              'four boxes, newest first, with ⏰ badges on what’s due. Tap a box to open its list. ' +
              '“Do Now” is the one to clear first.',
          },
        ]
      : []),
    {
      target: 'demo-add',
      ...(isMobile ? { also: 'nav-add' } : {}),
      title: 'Three kinds of task',
      body: isMobile
        ? 'Add with the ✚ tab. Say how urgent and important it is, then pick a type:'
        : 'Type it into the Task Manager above your grid, then open its 📅 Schedule chip — this ' +
          'panel — and pick a type:',
      bullets: [
        {
          lead: 'Task',
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
      target: 'demo-chat-ask',
      ...(isMobile ? { also: 'nav-chat' } : {}),
      title: 'Chat runs the whole app',
      body: isMobile
        ? 'Or skip the form entirely: open the 🐾 Chat tab and tell BabyClaw “add dentist Friday ' +
          '2pm,” “push the invoice to Monday,” or “what’s overdue?” — anytime, in plain words. He ' +
          'does it and stamps a receipt, like the ones here.'
        : 'Or skip the form entirely: tell BabyClaw “add dentist Friday 2pm,” “push the invoice to ' +
          'Monday,” or “what’s overdue?” — anytime, in plain words. He does it and stamps a ' +
          'receipt, like the ones here.',
    },
    {
      target: 'demo-plan',
      title: 'One tap plans your day',
      body:
        'This ✦ Plan My Day button turns your whole board into a realistic day. BabyClaw reads ' +
        'where you placed each task and the details — due dates, recurring chores, ongoing ' +
        'projects — to intelligently plan your day.',
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
      target: 'demo-habits',
      title: 'Daily habits',
      body:
        'Small routines you repeat — stretch, meds, walk the dog. Build them once and they sit ' +
        'right above your board every day; tap the paw to check one off. They reset every morning.',
    },
    {
      target: 'options',
      title: 'Done and Settings',
      // Name only what Settings actually holds: its tabs are Plan My Day / Notifications / AI /
      // Backups, plus the timezone picker and "Replay the tour". There is no reset-time control —
      // the daily reset is local midnight in your stored timezone, so the timezone IS the knob.
      body: isMobile
        ? 'Two more along the bottom. Done keeps everything you’ve finished, newest first — with ' +
          '↩ to put anything back on the board. Settings, under “More”, is where notifications, ' +
          'your timezone, backups, and this tour live.'
        : 'Two more along the top. Done keeps everything you’ve finished, newest first — with ↩ to ' +
          'put anything back on the board. Settings is where notifications, your timezone, ' +
          'backups, and this tour live.',
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
