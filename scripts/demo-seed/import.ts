#!/usr/bin/env -S node --import tsx
// Dev-only convenience: load the checked-in demo dataset (data.ts) into a LOCAL Supabase instance
// for manual UI testing. Never touches a remote/production database — it resolves its connection
// via `supabase status` (e2e/helpers/env.ts), which only ever returns the local stack's keys;
// there is no flag or code path that can point it at a remote DB.
//
// Usage:
//   npm run seed:demo -- --email you@example.com
//
// Requires: `supabase start` running locally, and a user already created (this app is
// sign-in-only — see docs/SETUP.md "Create a local user in Studio"). Assumes a clean slate for
// that user (it INSERTs); re-running duplicates rows.

import { Client } from 'pg'
import { resolveLocalSupabaseEnv } from '../../e2e/helpers/env'
import { DEMO_STATE } from './data'
import { insertSeedState } from './insert'

async function main() {
  const args = process.argv.slice(2)
  const emailFlagIndex = args.indexOf('--email')
  const email = emailFlagIndex >= 0 ? args[emailFlagIndex + 1] : undefined

  const { dbUrl } = resolveLocalSupabaseEnv()
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    if (!email) {
      const { rows } = await client.query<{ email: string }>(
        'select email from auth.users order by created_at',
      )
      console.error('Usage: npm run seed:demo -- --email <email>\n')
      if (rows.length > 0) {
        console.error('Local users found:')
        rows.forEach((r) => console.error(`  ${r.email}`))
      } else {
        console.error(
          'No local users found. Create one first — see docs/SETUP.md ("Create a local user in Studio").',
        )
      }
      process.exitCode = 1
      return
    }

    const { rows: userRows } = await client.query<{ id: string }>(
      'select id from auth.users where email = $1',
      [email],
    )
    const userRow = userRows[0]
    if (!userRow) {
      console.error(
        `No local user found with email "${email}". Create one first — see docs/SETUP.md.`,
      )
      process.exitCode = 1
      return
    }

    console.log(
      `Seeding ${DEMO_STATE.tasks.length} tasks, ${DEMO_STATE.habits.length} habits into ${email}...`,
    )
    const result = await insertSeedState(client, userRow.id, DEMO_STATE)
    console.log(
      `Inserted ${result.taskCount} tasks, ${result.habitCount} habits, ${result.historyCount} history entries.`,
    )
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
