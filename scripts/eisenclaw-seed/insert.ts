import type { Client } from 'pg'
import { deterministicId } from './ids'
import {
  mapHabit,
  mapHistoryEntry,
  mapTask,
  mapUserSchedule,
  PRE_TRACKING_CREATED_AT,
  type MapWarning,
} from './map'
import type { BackupSnapshot } from './source'
import type { OldPlannerState, OldUserSchedule } from './types'

export interface InsertResult {
  taskCount: number
  habitCount: number
  historyCount: number
  warnings: MapWarning[]
}

/**
 * Insert the mapped EisenClaw planner state (tasks, habits, history, schedule) for one user.
 * Assumes a clean slate for that user — this INSERTs, it does not upsert tasks/habits/history
 * (callers reset first: e2e's resetTestUserData, or a freshly-created local user).
 *
 * Task/habit ids are deterministic (derived from `userId:oldId`, see ids.ts) rather than
 * DB-generated, so a later --with-backups import of the same user's snapshots lines up with
 * the SAME rows (restore_backup upserts by id).
 */
export async function insertEisenclawState(
  client: Client,
  userId: string,
  planner: OldPlannerState,
  schedule: OldUserSchedule | null,
): Promise<InsertResult> {
  const warnings: MapWarning[] = []

  for (const oldTask of planner.tasks) {
    const t = mapTask(oldTask, warnings)
    const id = deterministicId(`${userId}:task:${oldTask.id}`)
    await client.query(
      `insert into public.tasks (id, user_id, text, x, y, due, staged, bucket, recurring, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        userId,
        t.text,
        t.x,
        t.y,
        t.due,
        t.staged,
        t.bucket,
        t.recurring ? JSON.stringify(t.recurring) : null,
        t.created_at,
      ],
    )
  }

  for (const oldHabit of planner.habits) {
    const h = mapHabit(oldHabit)
    const id = deterministicId(`${userId}:habit:${oldHabit.id}`)
    await client.query(
      `insert into public.habits (id, user_id, text, active, subtasks) values ($1,$2,$3,$4,$5)`,
      [id, userId, h.text, h.active, JSON.stringify(h.subtasks)],
    )
  }

  const historyEntries = planner.history ?? []
  for (const oldEntry of historyEntries) {
    const h = mapHistoryEntry(oldEntry)
    // task_id has no FK (history survives task deletion — see the history migration), so we
    // can safely point it at the deterministic id even if the referenced task is somehow absent.
    const taskId = deterministicId(`${userId}:task:${oldEntry.taskId}`)
    await client.query(
      `insert into public.history (user_id, task_id, text, bucket, completed_at) values ($1,$2,$3,$4,$5)`,
      [userId, taskId, h.text, h.bucket, h.completed_at],
    )
  }

  if (schedule) {
    const s = mapUserSchedule(schedule)
    await client.query(
      `insert into public.user_schedule (user_id, timezone, config) values ($1,$2,$3)
       on conflict (user_id) do update set timezone = excluded.timezone, config = excluded.config`,
      [userId, s.timezone, JSON.stringify(s.config)],
    )
  }

  return {
    taskCount: planner.tasks.length,
    habitCount: planner.habits.length,
    historyCount: historyEntries.length,
    warnings,
  }
}

/**
 * Insert historical planner-state snapshots directly into public.backups, in the shape
 * create_backup() would have produced (see supabase/migrations/20260702000000_backups.sql).
 * Ids reuse the SAME deterministic scheme as insertEisenclawState, so restoring one of these
 * updates the live tasks/habits rows rather than creating duplicates.
 */
export async function insertBackupSnapshots(
  client: Client,
  userId: string,
  snapshots: BackupSnapshot[],
  schedule: OldUserSchedule | null,
): Promise<{ count: number; warnings: MapWarning[] }> {
  const warnings: MapWarning[] = []
  const scheduleJson = schedule ? mapUserSchedule(schedule) : null

  for (const snapshot of snapshots) {
    const tasks = snapshot.state.tasks.map((oldTask) => {
      const t = mapTask(oldTask, warnings)
      return {
        id: deterministicId(`${userId}:task:${oldTask.id}`),
        user_id: userId,
        text: t.text,
        x: t.x,
        y: t.y,
        due: t.due,
        staged: t.staged,
        bucket: t.bucket,
        recurring: t.recurring,
        created_at: t.created_at,
        deleted_at: null,
      }
    })

    const habits = snapshot.state.habits.map((oldHabit) => {
      const h = mapHabit(oldHabit)
      return {
        id: deterministicId(`${userId}:habit:${oldHabit.id}`),
        user_id: userId,
        text: h.text,
        active: h.active,
        subtasks: h.subtasks,
        // habits.created_at is NOT NULL; the old format never tracked it, so restore_backup's
        // (e->>'created_at')::timestamptz needs SOMETHING here — fall back to the snapshot's
        // own timestamp, or the same pre-tracking date tasks use if that's unavailable.
        created_at: snapshot.takenAt ?? PRE_TRACKING_CREATED_AT,
        deleted_at: null,
      }
    })

    const data = {
      version: 1,
      tasks,
      habits,
      schedule: scheduleJson ? { user_id: userId, ...scheduleJson } : null,
    }

    const label = snapshot.takenAt
      ? `EisenClaw import — ${snapshot.takenAt.slice(0, 19).replace('T', ' ')}`
      : `EisenClaw import — ${snapshot.filename}`

    await client.query(
      `insert into public.backups (user_id, label, data, created_at)
       values ($1, $2, $3, coalesce($4::timestamptz, now()))`,
      [userId, label, JSON.stringify(data), snapshot.takenAt],
    )
  }

  return { count: snapshots.length, warnings }
}
