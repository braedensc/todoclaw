import { Client } from 'pg'
import { TEST_USER } from './constants'

// App tables that accumulate per-user state across runs. `history` is append-only at the app
// layer (SELECT+INSERT grant only — ADR-0012), which is exactly why we clean it as the Postgres
// superuser below rather than through PostgREST. Names are hardcoded constants (no injection).
const USER_SCOPED_TABLES = ['history', 'daily_state', 'tasks', 'habits', 'user_schedule'] as const

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
