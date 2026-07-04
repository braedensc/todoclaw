// Maps EisenClaw's flat-JSON planner shape (planning/eisenclaw-export/docs/todoclaw.md) onto
// todoclaw's Supabase row shapes (supabase/migrations/*_create_tasks.sql, *_create_habits.sql,
// *_history_and_daily_state_rpc.sql, *_create_user_schedule.sql). Pure functions, no I/O — the
// old->new schema mismatches are handled and FLAGGED here rather than silently dropped:
//
//   * bucket: the current schema only accepts 'oneoff' (src/types/task.ts, mirroring
//     EISENCLAW-LOGIC-TO-PORT.md Discrepancy #8 — the ORIGINAL client itself migrated
//     weekly/project -> oneoff as a one-time load fixup). Non-oneoff buckets are coerced the
//     same way here; the original value is dropped and a warning records it.
//   * recurring.doneCount: added to the schema after this reference data was captured — there
//     is no source value, so it defaults to 0 (a warning notes this).
//   * created_at: only tasks added after ~2026-05-19 have an explicit createdAt in the source.
//     Earlier tasks get a fixed pre-tracking date (not `now()`) so they sort as older and the
//     app's staleness "dust" rendering (src/lib/visual-urgency.ts) has aged cards to test
//     against — a warning notes the substitution.

import type { OldHabit, OldHistoryEntry, OldTask, OldUserSchedule } from './types'

export interface MapWarning {
  oldId?: string
  message: string
}

export interface MappedRecurring {
  frequencyDays: number
  lastDoneAt: string | null
  doneCount: number
}

export interface MappedTask {
  text: string
  x: number | null
  y: number | null
  due: string | null
  staged: boolean
  bucket: string
  recurring: MappedRecurring | null
  created_at: string
}

export interface MappedHabit {
  text: string
  active: boolean
  subtasks: { id: string; text: string }[]
}

export interface MappedHistoryEntry {
  text: string
  bucket: string | null
  completed_at: string
}

export interface MappedUserSchedule {
  timezone: string
  config: Record<string, unknown>
}

const ONLY_VALID_BUCKET = 'oneoff'
// Exported: also used as the created_at fallback for habits in backup snapshots (insert.ts),
// which never carried a createdAt field at all in the old format.
export const PRE_TRACKING_CREATED_AT = '2026-04-01T00:00:00.000Z'

export function mapTask(old: OldTask, warnings: MapWarning[]): MappedTask {
  if (old.bucket !== ONLY_VALID_BUCKET) {
    warnings.push({
      oldId: old.id,
      message: `bucket "${old.bucket}" has no home in the current schema (src/types/task.ts only accepts 'oneoff') — coerced to 'oneoff', original value dropped`,
    })
  }

  let recurring: MappedRecurring | null = null
  if (old.recurring) {
    recurring = {
      frequencyDays: old.recurring.frequencyDays,
      lastDoneAt: old.recurring.lastDoneAt,
      doneCount: 0,
    }
    warnings.push({
      oldId: old.id,
      message:
        'recurring.doneCount has no source value (added to the schema after this data was captured) — defaulted to 0',
    })
  }

  if (!old.createdAt) {
    warnings.push({
      oldId: old.id,
      message: `no createdAt in source — using fixed pre-tracking date ${PRE_TRACKING_CREATED_AT}`,
    })
  }

  return {
    text: old.text,
    x: old.x ?? null,
    y: old.y ?? null,
    due: old.due ? old.due : null,
    staged: old.staged,
    bucket: ONLY_VALID_BUCKET,
    recurring,
    created_at: old.createdAt ?? PRE_TRACKING_CREATED_AT,
  }
}

export function mapHabit(old: OldHabit): MappedHabit {
  return {
    text: old.text,
    active: old.active,
    subtasks: old.subtasks.map((s) => ({ id: s.id, text: s.text })),
  }
}

export function mapHistoryEntry(old: OldHistoryEntry): MappedHistoryEntry {
  return {
    text: old.text,
    bucket: old.bucket ? ONLY_VALID_BUCKET : null,
    completed_at: old.completedAt,
  }
}

export function mapUserSchedule(old: OldUserSchedule): MappedUserSchedule {
  const { timezone, ...rest } = old
  // Everything besides timezone (location, weekday, weekend, running, _meta, userId) is opaque
  // Plan-My-Day context — stored verbatim in `config` jsonb. `userId` is vestigial (the new
  // schema scopes by auth.uid(), not a config field) but harmless to keep for reference.
  return { timezone, config: rest }
}
