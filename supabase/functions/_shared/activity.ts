// activity.ts — the shared vocabulary of the task-activity log (public.task_activity, written by the
// log_task_activity() trigger). Three consumers read it: the AI evening recap (recap-prompt.ts), the
// deterministic recap fallback (dispatch.ts), and BabyClaw's chat context (chat-prompt.ts). Keeping
// the parse + human phrasing here means all three describe an action the same way.
//
// Rows arrive as opaque jsonb (from task_activity_for_user or a client select), so normalizeActivity
// is defensive; describeActivity + activityTally never throw on a malformed row.

import { formatClockTime } from './reminder-content.ts'

// One logged action. `detail` shape varies by kind (see the migration's per-kind jsonb).
export interface ActivityRow {
  kind: string
  taskText: string
  detail: Record<string, unknown>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Parse the RPC/select payload (untrusted jsonb) into typed rows, dropping anything malformed. */
export function normalizeActivity(raw: unknown): ActivityRow[] {
  if (!Array.isArray(raw)) return []
  const out: ActivityRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    const o = r as Record<string, unknown>
    const kind = typeof o.kind === 'string' ? o.kind : ''
    if (!kind) continue
    const detail =
      o.detail && typeof o.detail === 'object' && !Array.isArray(o.detail)
        ? (o.detail as Record<string, unknown>)
        : {}
    out.push({ kind, taskText: typeof o.task_text === 'string' ? o.task_text : '', detail })
  }
  return out
}

// A due-time detail ('HH:MM[:SS]') → " at 4:30 PM", or '' when absent/blank.
function atTime(v: unknown): string {
  const t = str(v)
  return t ? ` at ${formatClockTime(t)}` : ''
}

/**
 * One human, past-tense line for an action — the raw material the recap AI rewrites and the chat
 * context shows verbatim (both defang it with sanitizeForPrompt). Quotes the task title so a reader
 * can tell the task from the verb. Unknown kinds degrade to a bare "updated" line, never throw.
 */
export function describeActivity(row: ActivityRow): string {
  const t = row.taskText ? `"${row.taskText}"` : 'a task'
  const d = row.detail
  switch (row.kind) {
    case 'created':
      return d.ongoing === true
        ? `created ${t} as an ongoing project`
        : typeof d.recurring_days === 'number'
          ? `created ${t} (repeats every ${d.recurring_days}d)`
          : `created ${t}`
    case 'completed':
      return d.type === 'recurring' ? `checked off ${t} (recurring)` : `finished ${t}`
    case 'uncompleted':
      return `reopened ${t}`
    case 'deleted':
      return `deleted ${t}`
    case 'restored_from_trash':
      return `restored ${t}`
    case 'renamed':
      return str(d.from) ? `renamed "${str(d.from)}" to ${t}` : `renamed a task to ${t}`
    case 'due_set':
      return `set ${t} due ${str(d.due) ?? 'soon'}${atTime(d.due_time)}`
    case 'due_cleared':
      return `cleared the due date on ${t}`
    case 'made_recurring':
      return typeof d.frequency_days === 'number'
        ? `made ${t} repeat every ${d.frequency_days}d`
        : `made ${t} recurring`
    case 'recurring_retuned':
      return typeof d.frequency_days === 'number'
        ? `changed ${t} to repeat every ${d.frequency_days}d`
        : `retuned ${t}'s cadence`
    case 'made_ongoing':
      return `made ${t} an ongoing project`
    case 'type_cleared':
      return `made ${t} a one-off task again`
    case 'paused':
      return `paused ${t}${str(d.until) ? ` until ${str(d.until)}` : ''}`
    case 'resumed':
      return `un-paused ${t}`
    case 'placed':
      return str(d.quadrant) ? `placed ${t} in ${str(d.quadrant)}` : `placed ${t} on the grid`
    case 'moved':
      return str(d.from_quadrant) && str(d.to_quadrant)
        ? `moved ${t} from ${str(d.from_quadrant)} to ${str(d.to_quadrant)}`
        : `re-prioritized ${t}`
    default:
      return `updated ${t}`
  }
}

// Coarse buckets for the one-line tally in the deterministic fallback ("3 done · 2 created · 1 moved").
const TALLY_LABEL: Record<string, string> = {
  completed: 'done',
  created: 'created',
  deleted: 'deleted',
  moved: 'moved',
  placed: 'placed',
  renamed: 'renamed',
  due_set: 're-dated',
  due_cleared: 're-dated',
  made_ongoing: 'reorganized',
  made_recurring: 'reorganized',
  recurring_retuned: 'reorganized',
  type_cleared: 'reorganized',
  paused: 'paused',
  resumed: 'un-paused',
  uncompleted: 'reopened',
  restored_from_trash: 'restored',
}

/** A compact "3 done · 2 created · 1 moved" tally, most-frequent first, top 4; null when empty. */
export function activityTally(rows: ActivityRow[]): string | null {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const label = TALLY_LABEL[r.kind]
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, n]) => `${n} ${label}`)
    .join(' · ')
}
