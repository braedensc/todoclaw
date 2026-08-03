import { Client } from 'pg'
import { DEMO_STATE } from '../../scripts/demo-seed/data'
import { insertSeedState } from '../../scripts/demo-seed/insert'
import { TEST_USER } from './constants'

// App tables that accumulate per-user state across runs. `history` is append-only at the app
// layer (SELECT+INSERT grant only — ADR-0012) and `backups` snapshots persist until pruned, which
// is exactly why we clean them as the Postgres superuser below rather than through PostgREST.
// Names are hardcoded constants (no injection). `backups` has no FK to the others, so order is
// unconstrained — it just needs to be wiped too, or the backups spec's empty-state assertion
// fails on the second run.
const USER_SCOPED_TABLES = [
  'history',
  'daily_state',
  'tasks',
  'habits',
  'user_schedule',
  'backups',
  // Persistent BabyClaw chats (persistent-chats ADR). chat_messages cascades from chat_sessions,
  // so wiping sessions is enough — but list both so an added FK/behavior change stays covered.
  'chat_sessions',
] as const

/**
 * Delete all of the test user's app rows so each spec starts from an identical clean slate.
 * Connects to local Postgres as the superuser (DB_URL from `supabase status`), which bypasses
 * RLS *and* the history table's append-only grant cleanly. Local stack only — never a remote DB
 * (ADR-0018). The user row itself is left intact, so the persisted session stays valid.
 */
export async function resetTestUserData(dbUrl: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    for (const table of USER_SCOPED_TABLES) {
      await client.query(
        `DELETE FROM public.${table} WHERE user_id = (SELECT id FROM auth.users WHERE email = $1)`,
        [TEST_USER.email],
      )
    }
  } finally {
    await client.end()
  }
}

/**
 * Load the checked-in demo dataset (scripts/demo-seed/data.ts) into the test user's rows, for
 * specs that want to exercise the app against realistic data instead of an empty slate.
 *
 * Opt-in per spec: call `resetTestUserData()` (already done by the `page` fixture) then this,
 * inside the test body — NOT wired into the shared fixture, so existing golden specs keep
 * running against an empty slate unless they explicitly ask for this data.
 */
export async function seedDemoFixtures(dbUrl: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: string }>(
      'SELECT id FROM auth.users WHERE email = $1',
      [TEST_USER.email],
    )
    const userRow = rows[0]
    if (!userRow)
      throw new Error(
        `Test user ${TEST_USER.email} not found — run the golden setup project first.`,
      )

    await insertSeedState(client, userRow.id, DEMO_STATE)
  } finally {
    await client.end()
  }
}
