// Build the app for the acceptance check (docs/PIPELINE-CONTRACT.md §1 `acceptance.build`,
// §15). The check builds this at a pull request's head, in a sandbox with no network, and
// serves the folder it writes: no server process, no real service.
//
// THE ENVIRONMENT IS SET HERE AND NOWHERE ELSE. The contract asks for "no secret in the build's
// environment: dummy service settings belong in the project's own script". So:
//   - the Supabase URL and key are DUMMIES: the loopback URL the fake backend answers
//     (e2e/acceptance/fake-backend.mjs) and a value that is not a JWT;
//   - every other VITE_* setting is blanked, so a real Sentry DSN or push key in the machine's
//     environment never reaches the bundle; and
//   - `envDir` points at an empty folder, so a local env file full of real values is never read.
//
// THIS FILE IS A GRADER PATH (delivery.json `stack.graderPaths` and `autonomy.riskPaths`):
// changing the URL here changes what the check calls.
//
//   node scripts/build-acceptance.mjs        # writes dist-acceptance/
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'vite'
import { SUPA } from '../e2e/acceptance/fake-backend.mjs'

export const OUT_DIR = 'dist-acceptance'

process.env.VITE_SUPABASE_URL = SUPA
process.env.VITE_SUPABASE_ANON_KEY = 'acceptance-dummy-anon-key'
process.env.VITE_SENTRY_DSN = ''
process.env.VITE_VAPID_PUBLIC_KEY = ''
// No commit marker either: an empty one switches the app's update check off.
process.env.VERCEL_GIT_COMMIT_SHA = ''
process.env.VERCEL_ENV = ''

const emptyEnvDir = mkdtempSync(join(tmpdir(), 'todoclaw-acceptance-env-'))
try {
  await build({
    envDir: emptyEnvDir,
    logLevel: 'warn',
    build: { outDir: OUT_DIR, emptyOutDir: true },
  })
} finally {
  rmSync(emptyEnvDir, { recursive: true, force: true })
}
console.log(`acceptance build: ${OUT_DIR}/ (dummy services at ${SUPA}, no env file read)`)
