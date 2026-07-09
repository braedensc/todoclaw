import type { TourStep } from './FeatureTour'

// The tour scripts. Every `target` names a `data-tour` anchor in the shell; FeatureTour silently
// drops steps whose anchor isn't mounted, so these lists can be generous. Copy rules: plain
// words (a first-run non-technical user), each step teaches ONE idea, and the app's core model —
// tasks on an urgent × important map — leads.

/** Desktop home shell: grid → Task Manager → Plan My Day → habits → Done → Settings. */
export const DESKTOP_TOUR: TourStep[] = [
  {
    target: 'grid',
    title: 'Your tasks live on a map',
    body:
      'Every task is a card on this grid. Further right = more urgent, higher up = more ' +
      'important — so the top-right corner is always “do now”. Drag cards around as things change.',
  },
  {
    target: 'task-input',
    title: 'Add tasks by just saying them',
    body:
      'This is the Task Manager. Tell BabyClaw — your AI helper — things like “dentist Friday ' +
      '2pm” and he adds and places them for you (Open chat shows the whole conversation). ' +
      'Prefer full control? Switch to Manual.',
  },
  {
    target: 'plan',
    title: 'One tap plans your day',
    body:
      'Plan My Day reads your tasks, habits, and schedule and drafts a realistic plan for ' +
      'today. Add a task or two first, then give it a try.',
  },
  {
    target: 'habits',
    title: 'Daily habits',
    body:
      'Small routines you repeat — stretch, meds, walk the dog — live here. Check each off ' +
      'with a paw print every day; they reset each morning.',
  },
  {
    target: 'done',
    title: 'Everything you finish is remembered',
    body:
      'Done keeps your completion history. Finished something by mistake? Restore it from ' +
      'there and it pops back onto the grid.',
  },
  {
    target: 'settings',
    title: 'Make it yours',
    body:
      'Settings holds your daily schedule (better plans), notification times, and BabyClaw’s ' +
      'personality. Worth a minute once you’ve settled in.',
  },
]

/** Mobile home shell: quadrant overview → ➕ add → Chat → Plan My Day → More. */
export const MOBILE_TOUR: TourStep[] = [
  {
    target: 'matrix',
    title: 'Your tasks, sorted into four boxes',
    body:
      'Tasks sort by how urgent and important they are — “Do Now” is the box to clear first. ' +
      'Tap any box to open its list.',
  },
  {
    target: 'nav-add',
    title: 'Add a task here',
    body:
      'Tap ➕, describe the task, and pick how urgent + important it feels. It lands in the ' +
      'right box automatically.',
  },
  {
    target: 'nav-chat',
    title: 'Or just tell BabyClaw',
    body:
      'Chat is BabyClaw, your AI helper — say “add vet appointment Friday, important” and it’s ' +
      'done. He can also move, finish, and clean up tasks for you.',
  },
  {
    target: 'plan',
    title: 'One tap plans your day',
    body:
      'Plan My Day turns your tasks, habits, and schedule into a realistic plan for today. Add ' +
      'a task or two first, then give it a try.',
  },
  {
    target: 'nav-more',
    title: 'Everything else lives in More',
    body: 'Daily habits, your inbox, Settings, and Backups are all one tap away in here.',
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
