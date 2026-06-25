// placement.ts — the due-date → grid-position auto-placement. EisenClaw's spec
// ("Due Date → Urgency/Importance Auto-Inference") was BabyClaw/chat behavior, never in the old
// client or server (LOGIC-TO-PORT Discrepancy #5), so it's implemented fresh here from the spec
// table and used by the chat's create_task / set_due_date tools. Pure → exhaustively deno-tested.

import { localDateInTZ } from './dates.ts'

export interface Placement {
  x: number
  y: number
  staged: boolean
}

// Urgency (x) is inferred from days-until-due; importance (y) is 0.75 when a due date is given
// (the user cared enough to set one) else 0.50; a due date places the card on the grid
// (staged=false), no due date stages it at center.
export function placeByDue(
  due: string | null,
  timeZone: string,
  now: Date = new Date(),
): Placement {
  if (!due) return { x: 0.5, y: 0.5, staged: true }
  const d = daysUntilLocal(due, timeZone, now)
  const x =
    d <= 0
      ? 0.9 // overdue / today      → Do Now
      : d <= 2
        ? 0.84 // 1–2 days
        : d <= 7
          ? 0.7 // 3–7 days
          : d <= 14
            ? 0.55 // 1–2 weeks
            : d <= 28
              ? 0.32 // 2–4 weeks    → Schedule
              : 0.18 // 1–3 months (and beyond) → low urgency
  return { x, y: 0.75, staged: false }
}

export type UrgencyWord = 'low' | 'medium' | 'high'
export type ImportanceWord = 'low' | 'high'

// Word → coordinate, for the chat move_task tool's verbal path ("make it more important").
export function urgencyToX(word: UrgencyWord): number {
  return word === 'high' ? 0.84 : word === 'medium' ? 0.55 : 0.18
}
export function importanceToY(word: ImportanceWord): number {
  return word === 'high' ? 0.75 : 0.5
}

// Same calendar-day diff as src/lib/scoring.ts daysUntil: collapse both ends to a date in the
// user's timezone before diffing, so it's DST-safe and time-of-day independent.
function daysUntilLocal(due: string, timeZone: string, now: Date): number {
  const MS = 86_400_000
  const dueDay = Date.parse(`${localDateInTZ(timeZone, new Date(due))}T00:00:00Z`) / MS
  const nowDay = Date.parse(`${localDateInTZ(timeZone, now)}T00:00:00Z`) / MS
  return Math.round(dueDay - nowDay)
}
