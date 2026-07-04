#!/usr/bin/env -S node --import tsx
// Dev-only convenience: load Braeden's real EisenClaw tasks/habits into a LOCAL Supabase
// instance for manual UI testing. Never touches a remote/production database — it resolves
// its connection via `supabase status` (e2e/helpers/env.ts), which only ever returns the
// local stack's keys; there is no flag or code path that can point it at a remote DB.
//
// Usage:
//   npm run seed:eisenclaw -- --email you@example.com
//   npm run seed:eisenclaw -- --email you@example.com --with-backups
//
// Requires: `supabase start` running locally, and a user already created (this app is
// sign-in-only — see docs/SETUP.md "Create a local user in Studio").

import { Client } from 'pg'
import { resolveLocalSupabaseEnv } from '../../e2e/helpers/env'
import { insertBackupSnapshots, insertEisenclawState } from './insert'
import {
  readBackupSnapshots,
  readPlannerState,
  readUserSchedule,
  resolveEisenclawDataDir,
} from './source'

async function main() {
  const args = process.argv.slice(2)
  const emailFlagIndex = args.indexOf('--email')
  const email = emailFlagIndex >= 0 ? args[emailFlagIndex + 1] : undefined
  const withBackups = args.includes('--with-backups')

  const { dbUrl } = resolveLocalSupabaseEnv()
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  try {
    if (!email) {
      const { rows } = await client.query<{ email: string }>(
        'select email from auth.users order by created_at',
      )
      console.error('Usage: npm run seed:eisenclaw -- --email <email> [--with-backups]\n')
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
    const userId = userRow.id

    const dataDir = resolveEisenclawDataDir()
    const planner = readPlannerState(dataDir)
    const schedule = readUserSchedule(dataDir)

    console.log(
      `Importing ${planner.tasks.length} tasks, ${planner.habits.length} habits into ${email}...`,
    )
    const result = await insertEisenclawState(client, userId, planner, schedule)
    console.log(
      `Inserted ${result.taskCount} tasks, ${result.habitCount} habits, ${result.historyCount} history entries.`,
    )

    if (withBackups) {
      const snapshots = readBackupSnapshots(dataDir)
      const backupResult = await insertBackupSnapshots(client, userId, snapshots, schedule)
      console.log(`Inserted ${backupResult.count} historical backup snapshots.`)
      result.warnings.push(...backupResult.warnings)
    }

    if (result.warnings.length > 0) {
      console.log(`\n${result.warnings.length} field(s) didn't map 1:1 onto the current schema:`)
      const seen = new Set<string>()
      for (const w of result.warnings) {
        if (seen.has(w.message)) continue // dedupe repeated warning text (e.g. doneCount default)
        seen.add(w.message)
        console.log(`  - ${w.message}`)
      }
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
