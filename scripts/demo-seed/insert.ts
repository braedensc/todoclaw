import type { Client } from 'pg'
import type { SeedState } from './types'

export interface SeedResult {
  taskCount: number
  habitCount: number
  historyCount: number
}

/**
 * Insert the demo state (tasks, habits, history, schedule) for one user. Assumes a clean slate
 * for that user — this INSERTs, it does not upsert (callers reset first: e2e's resetTestUserData,
 * or a freshly-created local user). Row ids are DB-generated (gen_random_uuid); the demo seed has
 * no backup-restore step, so it needs no deterministic ids. Local Supabase only — never a remote DB.
 */
export async function insertSeedState(
  client: Client,
  userId: string,
  state: SeedState = {
    tasks: [],
    habits: [],
    history: [],
    schedule: { timezone: 'UTC', config: {} },
  },
): Promise<SeedResult> {
  for (const t of state.tasks) {
    await client.query(
      `insert into public.tasks (user_id, text, x, y, due, staged, bucket, recurring, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
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

  for (const h of state.habits) {
    await client.query(
      `insert into public.habits (user_id, text, active, subtasks) values ($1,$2,$3,$4)`,
      [userId, h.text, h.active, JSON.stringify(h.subtasks)],
    )
  }

  for (const entry of state.history) {
    // task_id has no FK (history survives task deletion — see the history migration); the demo
    // history isn't tied to a live task, so leave it null.
    await client.query(
      `insert into public.history (user_id, task_id, text, bucket, completed_at) values ($1,$2,$3,$4,$5)`,
      [userId, null, entry.text, entry.bucket, entry.completed_at],
    )
  }

  await client.query(
    `insert into public.user_schedule (user_id, timezone, config) values ($1,$2,$3)
     on conflict (user_id) do update set timezone = excluded.timezone, config = excluded.config`,
    [userId, state.schedule.timezone, JSON.stringify(state.schedule.config)],
  )

  return {
    taskCount: state.tasks.length,
    habitCount: state.habits.length,
    historyCount: state.history.length,
  }
}
