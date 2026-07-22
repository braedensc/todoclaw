// db.ts — provision, seed, and snapshot scenario users on the LOCAL Supabase stack.
//
// Superuser access (postgres:postgres) is deliberate: seeding needs columns/tables clients have no
// grants for (write-caps era), the activity-trigger GUC, and the AI ledgers. env.ts hard-fails on
// any non-local URL before this module ever connects.
//
// Reused app logic instead of re-implementing: dueInstant (src/lib/dates.ts) for reminder fire_at,
// dayOffsetISO for the daily_state local-date key.

import postgres from 'npm:postgres@3.4.5'
import { dueInstant } from '../../src/lib/dates.ts'
import { dayOffsetISO, DEFAULT_TZ } from './fixture-dates.ts'
import type { DbSnapshot, DbTaskRow, EvalEnvLike, SeedIds, SeedSpec } from './db-types.ts'

export type Sql = ReturnType<typeof postgres>

export function connectDb(dbUrl: string): Sql {
  return postgres(dbUrl, { onnotice: () => {}, max: 4 })
}

// ---------- provisioning ----------

/** Create (idempotently) a confirmed user via the GoTrue admin API — public signup is disabled
 * in this project, so the admin endpoint is the only path. Returns the user id. */
export async function ensureUser(
  env: EvalEnvLike,
  sql: Sql,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${env.apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!res.ok) {
    const body = await res.text()
    if (!/already|exists/i.test(body)) {
      throw new Error(
        `evals: admin user create failed for ${email}: ${res.status} ${body.slice(0, 300)}`,
      )
    }
  } else {
    await res.body?.cancel()
  }
  const rows = await sql`select id from auth.users where email = ${email}`
  if (!rows.length) throw new Error(`evals: user ${email} not found after create`)
  return rows[0].id as string
}

const tokenCache = new Map<string, { token: string; at: number }>()

/** Password-grant sign-in; tokens cached ~50 min (local jwt_expiry is 3600s). */
export async function signIn(env: EvalEnvLike, email: string, password: string): Promise<string> {
  const hit = tokenCache.get(email)
  if (hit && Date.now() - hit.at < 50 * 60_000) return hit.token
  const res = await fetch(`${env.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: env.anonKey },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok)
    throw new Error(`evals: sign-in failed for ${email}: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error(`evals: sign-in for ${email} returned no access_token`)
  tokenCache.set(email, { token: json.access_token, at: Date.now() })
  return json.access_token
}

// ---------- stack prep ----------

/** Raise the owner-tunable rate limits to their hard clamps and clear the AI usage/budget
 * ledgers, so a suite run never trips guardrails left over from a previous run. LOCAL ONLY —
 * env.ts guarantees that. Note: the functions-serve isolate caches guardrail config ~30s. */
export async function prepareStack(sql: Sql): Promise<void> {
  await sql`
    update app_config set
      chat_hour_limit = 200, chat_day_limit = 2000,
      plan_hour_limit = 50, plan_day_limit = 50,
      global_budget_cap_micros = 100000000, user_budget_cap_micros = 50000000
    where id = 1`
  for (const table of ['ai_usage', 'ai_user_budget_ledger', 'ai_budget_ledger']) {
    try {
      await sql`delete from ${sql(table)}`
    } catch {
      // table renamed/absent — tolerable; guardrails fall back to defaults
    }
  }
}

/** Per-user wipe across every user-scoped table the harness cares about (a superset of the
 * golden suite's list: memories, activity, messages, and usage included so scenarios never
 * contaminate each other). chat_messages / task_reminders cascade from their parents. */
export async function wipeUser(sql: Sql, userId: string): Promise<void> {
  const tables = [
    'history',
    'daily_state',
    'tasks',
    'habits',
    'user_schedule',
    'backups',
    'chat_sessions',
    'assistant_memories',
    'task_activity',
    'messages',
    'push_subscriptions',
    'ai_usage',
    'ai_user_budget_ledger',
  ]
  for (const table of tables) {
    try {
      await sql`delete from ${sql(table)} where user_id = ${userId}`
    } catch {
      // absent table or no user_id column — skip
    }
  }
}

// ---------- seeding ----------

export async function seedScenario(sql: Sql, userId: string, spec: SeedSpec): Promise<SeedIds> {
  const tz = spec.timezone ?? DEFAULT_TZ
  const ids: SeedIds = { tasks: {}, habits: {} }
  const today = dayOffsetISO(0, tz)
  const done: Record<string, boolean> = {}
  const habitDone: Record<string, boolean> = {}

  await sql.begin(async (tx) => {
    if (!spec.activityToday) {
      // Seed rows are scenario setup, not "things the user did today" — keep them out of the
      // activity log (and therefore out of recap/chat activity context) unless asked for.
      await tx`select set_config('todoclaw.suppress_activity', 'on', true)`
    }

    const config: Record<string, unknown> = { ...(spec.scheduleConfig ?? {}) }
    if (spec.weather) config.location = spec.weather.location
    await tx`
      insert into user_schedule (user_id, timezone, config)
      values (${userId}, ${tz}, ${JSON.stringify(config)}::jsonb)
      on conflict (user_id) do update set timezone = excluded.timezone, config = excluded.config`

    for (const [i, t] of (spec.tasks ?? []).entries()) {
      const rows = await tx`
        insert into tasks (user_id, text, x, y, due, due_time, staged, bucket, recurring, ongoing,
                           size, start_date, completed_at)
        values (${userId}, ${t.text}, ${t.x ?? null}, ${t.y ?? null}, ${t.due ?? null},
                ${t.dueTime ?? null}, ${t.staged ?? false}, 'oneoff',
                ${t.recurring ? JSON.stringify(t.recurring) : null}::jsonb, ${t.ongoing ?? false},
                ${t.size ?? null}, ${t.startDate ?? null}, ${t.completedAt ?? null})
        returning id`
      const id = rows[0].id as string
      ids.tasks[t.key ?? `task${i}`] = id
      if (t.doneToday) done[id] = true
      for (const offset of t.reminders ?? []) {
        if (!t.due || !t.dueTime) {
          throw new Error(`evals seed: task "${t.text}" has reminders but no due+dueTime`)
        }
        const fireAt = new Date(dueInstant(t.due, t.dueTime, tz).getTime() - offset * 60_000)
        await tx`
          insert into task_reminders (user_id, task_id, offset_minutes, fire_at)
          values (${userId}, ${id}, ${offset}, ${fireAt.toISOString()})`
      }
    }

    for (const [i, h] of (spec.habits ?? []).entries()) {
      const rows = await tx`
        insert into habits (user_id, text, active, subtasks)
        values (${userId}, ${h.text}, ${h.active ?? true},
                ${JSON.stringify(h.subtasks ?? [])}::jsonb)
        returning id`
      const id = rows[0].id as string
      ids.habits[h.key ?? `habit${i}`] = id
      if (h.doneToday) habitDone[id] = true
    }

    if (Object.keys(done).length || Object.keys(habitDone).length) {
      await tx`
        insert into daily_state (user_id, date, done, habit_done, subtask_done)
        values (${userId}, ${today}, ${JSON.stringify(done)}::jsonb,
                ${JSON.stringify(habitDone)}::jsonb, '{}'::jsonb)
        on conflict (user_id, date) do update
          set done = excluded.done, habit_done = excluded.habit_done`
    }

    for (const m of spec.memories ?? []) {
      await tx`insert into assistant_memories (user_id, content) values (${userId}, ${m})`
    }

    for (const h of spec.history ?? []) {
      await tx`
        insert into history (user_id, text, bucket, completed_at)
        values (${userId}, ${h.text}, 'oneoff', ${h.completedAt})`
    }

    if (spec.weather) {
      await tx`
        insert into weather_cache (location, data)
        values (${spec.weather.location}, ${JSON.stringify(spec.weather.data)}::jsonb)
        on conflict (location) do update set data = excluded.data, fetched_at = now()`
    }
  })

  return ids
}

// ---------- post-run snapshot ----------

export async function snapshotUser(sql: Sql, userId: string, ids: SeedIds): Promise<DbSnapshot> {
  const tz = DEFAULT_TZ
  const tasks = (await sql`
    select id, text, x, y, due, due_time, staged, size, ongoing, recurring, start_date,
           completed_at, deleted_at
    from tasks where user_id = ${userId}`) as unknown as DbTaskRow[]
  const reminders = (await sql`
    select task_id, offset_minutes from task_reminders
    where user_id = ${userId} and sent_at is null`) as unknown as {
    task_id: string
    offset_minutes: number
  }[]
  const memories = (await sql`
    select id, content from assistant_memories where user_id = ${userId}
    order by created_at`) as unknown as { id: string; content: string }[]
  const daily = await sql`
    select done, habit_done from daily_state
    where user_id = ${userId} and date = ${dayOffsetISO(0, tz)}`
  const history = await sql`select text from history where user_id = ${userId}`
  return {
    ids,
    tasks,
    reminders,
    memories,
    dailyDone: (daily[0]?.done ?? {}) as Record<string, boolean>,
    dailyHabitDone: (daily[0]?.habit_done ?? {}) as Record<string, boolean>,
    historyTexts: history.map((r) => r.text as string),
  }
}
