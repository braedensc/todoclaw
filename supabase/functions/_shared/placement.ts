// placement.ts — the due-date → grid-position auto-placement. EisenClaw's spec
// ("Due Date → Urgency/Importance Auto-Inference") was BabyClaw/chat behavior, never in the old
// client or server (LOGIC-TO-PORT Discrepancy #5), so it's implemented fresh here from the spec
// table and used by the chat's create_task / set_due_date tools. Pure → exhaustively deno-tested.

import { daysUntilInTZ } from './dates.ts'

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
  const d = daysUntilInTZ(due, timeZone, now) as number // non-null: due checked above
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
export type ImportanceWord = 'low' | 'medium' | 'high'

// Word → coordinate, for the chat tools' verbal path (create_task / "make it more important").
export function urgencyToX(word: UrgencyWord): number {
  return word === 'high' ? 0.84 : word === 'medium' ? 0.55 : 0.18
}
// Importance (y): low sits clearly in the minor half, high in the major half, medium on the split.
// (Was two-level low=0.5 / high=0.75; low dropped to 0.25 so a genuinely minor task — a routine
// chore — reads as clearly minor instead of straddling the quadrant line.)
export function importanceToY(word: ImportanceWord): number {
  return word === 'high' ? 0.75 : word === 'medium' ? 0.5 : 0.25
}
