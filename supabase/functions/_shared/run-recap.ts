// run-recap.ts — the end-of-day recap message (ADR-0031), built DETERMINISTICALLY from the day's
// completions. This is the "works without AI" backbone of the evening push: given today's daily_state
// done maps + the user's tasks/habits, it produces a title + body with NO model call. The dispatcher
// may optionally enrich the body with a one-sentence AI nudge (gated by the same budget guardrails),
// but if AI is paused — or absent entirely — this deterministic recap is what ships. Pure + total, so
// it is fully unit-tested and can never fail a send.

// The subset of a task/habit the recap needs. `id` matches the keys in the daily_state done maps.
export interface RecapTask {
  id: string
  text: string
}

export interface RecapInputs {
  tasks: RecapTask[] // active (non-deleted) tasks
  habits: RecapTask[] // active habits
  doneTaskIds: Record<string, boolean> // daily_state.done  { taskId: true }
  doneHabitIds: Record<string, boolean> // daily_state.habit_done { habitId: true }
}

export interface Recap {
  title: string
  body: string
  completedCount: number // tasks + habits done today (drives whether the dispatcher bothers sending)
}

const MAX_NAMED = 3 // list at most this many task names inline; the rest collapse to "+N more"

function truthy(map: Record<string, boolean>, id: string): boolean {
  return map[id] === true
}

// "Alpha, Beta, Gamma +2 more" — names up to MAX_NAMED items, collapsing the tail to a count.
function nameList(items: RecapTask[]): string {
  const names = items.map((i) => i.text.trim()).filter((t) => t.length > 0)
  if (names.length <= MAX_NAMED) return names.join(', ')
  return `${names.slice(0, MAX_NAMED).join(', ')} +${names.length - MAX_NAMED} more`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// Build the evening recap. Deterministic: same inputs → same message, no AI, no randomness.
export function buildRecap(inputs: RecapInputs): Recap {
  const completedTasks = inputs.tasks.filter((t) => truthy(inputs.doneTaskIds, t.id))
  const openTasks = inputs.tasks.filter((t) => !truthy(inputs.doneTaskIds, t.id))
  const doneHabits = inputs.habits.filter((h) => truthy(inputs.doneHabitIds, h.id))
  const completedCount = completedTasks.length + doneHabits.length

  const title = 'Your day, wrapped'

  // Nothing done: encouraging, not scolding — and acknowledge an already-clear list differently.
  if (completedCount === 0) {
    const body =
      openTasks.length === 0
        ? 'Nothing on the board today — enjoy the quiet. Fresh start tomorrow.'
        : `No tasks marked done today — no worries. ${plural(openTasks.length, 'task is', 'tasks are')} ready when you are.`
    return { title, body, completedCount }
  }

  const parts: string[] = []
  if (completedTasks.length > 0) {
    parts.push(
      `You finished ${plural(completedTasks.length, 'task', 'tasks')}: ${nameList(completedTasks)}.`,
    )
  }
  if (doneHabits.length > 0) {
    parts.push(`Habits: ${nameList(doneHabits)}.`)
  }
  if (openTasks.length > 0) {
    parts.push(`${plural(openTasks.length, 'task', 'tasks')} still open for tomorrow.`)
  } else if (completedTasks.length > 0) {
    parts.push('That clears your list — nice.')
  }

  return { title, body: parts.join(' '), completedCount }
}
