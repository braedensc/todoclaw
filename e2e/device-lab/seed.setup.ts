import fs from 'node:fs'
import path from 'node:path'
import { test as setup } from '@playwright/test'
import { resolveLocalSupabaseEnv } from '../helpers/env'
import { resetTestUserData, seedDemoFixtures } from '../helpers/db'
import { REPORT_DIR, SHOTS_DIR } from './report-paths'

// Device-lab bootstrap (after the golden auth setup): load the checked-in demo dataset once so
// every device screenshots the same realistic planner, and start from a clean report directory so
// the contact sheet never mixes shots from two runs. The device specs themselves are read-only,
// which is what lets them run in parallel against this one seeded user.
setup('seed demo data + reset report dir', async () => {
  fs.rmSync(REPORT_DIR, { recursive: true, force: true })
  fs.mkdirSync(SHOTS_DIR, { recursive: true })

  const { dbUrl } = resolveLocalSupabaseEnv()
  await resetTestUserData(dbUrl)
  await seedDemoFixtures(dbUrl)
  // Sanity: the report dir is where every spec writes; fail here (once) rather than 28 times.
  if (!fs.existsSync(path.join(SHOTS_DIR))) throw new Error('device-lab report dir was not created')
})
