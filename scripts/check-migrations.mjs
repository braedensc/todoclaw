// check-migrations.mjs — deterministic guard against the two migration mistakes that wedged the
// prod deploy on 2026-07-09:
//   1. DUPLICATE version — two files sharing the 14-digit timestamp. Supabase keys migrations by
//      that number (schema_migrations primary key), so the second collides and errors db push/reset.
//   2. OUT-OF-ORDER version — a new migration that sorts BEFORE one already on the base branch.
//      `supabase db push` hard-stops on it ("…inserted before the last migration on remote…") and
//      applies NOTHING further — every later migration AND the Edge Function deploy silently stall.
//
// Both are checked at PR time against the base branch (default origin/main), so the author gets an
// instant, hard failure with a fix hint instead of a green PR that quietly breaks the deploy after
// merge. Only migrations this branch ADDS are judged; pre-existing history is left alone. No deps.
//
// Usage:
//   node scripts/check-migrations.mjs          # base = origin/main (override with BASE_REF)
//   BASE_REF=origin/main node scripts/…        # explicit
// Exit 0 = clean, 1 = a problem.

import { readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const DIR = 'supabase/migrations'
const NAME_RE = /^(\d{14})_.+\.sql$/
const BASE_REF = process.env.BASE_REF || 'origin/main'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

// Migration filenames tracked at a git ref ([] if the ref is missing — e.g. origin/main not fetched).
function filesAtRef(ref) {
  try {
    const out = git(['ls-tree', '-r', '--name-only', ref, '--', DIR])
    return out ? out.split('\n').map((p) => p.slice(DIR.length + 1)) : []
  } catch {
    return null // ref unresolvable
  }
}

function versionOf(file) {
  const m = file.match(NAME_RE)
  return m ? m[1] : null
}

const baseFiles = filesAtRef(BASE_REF)
if (baseFiles === null) {
  // No base to compare against (offline / shallow clone without origin/main). Fail open on the
  // base-relative checks rather than block; CI always fetches the base, so this only affects local.
  console.warn(`⚠ migration guard: could not resolve ${BASE_REF}; skipping base-relative checks.`)
}

const headFiles = readdirSync(DIR).filter((f) => f.endsWith('.sql'))
const baseSet = new Set(baseFiles ?? [])
const baseVersions = new Set((baseFiles ?? []).map(versionOf).filter(Boolean))
const sortedBase = [...baseVersions].sort()
const baseMax = sortedBase.length ? sortedBase[sortedBase.length - 1] : null

// Migrations this branch adds = present now, absent from base (a rename shows up as its new name).
const added = headFiles.filter((f) => !baseSet.has(f))
const errors = []

// 1. Naming — every migration must carry the 14-digit version we key on.
const misnamed = added.filter((f) => !NAME_RE.test(f))
for (const f of misnamed) errors.push(`${f}: must be named <14-digit-timestamp>_<name>.sql`)
const valid = added.filter((f) => NAME_RE.test(f))

// 2. Duplicate version vs the base branch (schema_migrations primary-key collision).
for (const f of valid) {
  if (baseVersions.has(versionOf(f))) {
    errors.push(
      `${f}: version ${versionOf(f)} already exists on ${BASE_REF} — a duplicate schema_migrations ` +
        `key that errors db push/reset. Renumber to a unique, later timestamp.`,
    )
  }
}

// 3. Duplicate version among the newly added files themselves (two parallel commits, same stamp).
const byVersion = new Map()
for (const f of valid) byVersion.set(versionOf(f), [...(byVersion.get(versionOf(f)) ?? []), f])
for (const [v, fs] of byVersion) {
  if (fs.length > 1)
    errors.push(`version ${v} is used by ${fs.length} new migrations: ${fs.join(', ')}`)
}

// 4. Ordering — a new migration must sort AFTER every migration already on base, or db push refuses
//    it (and an out-of-order apply can assume a schema state that doesn't exist yet).
if (baseMax) {
  for (const f of valid) {
    if (versionOf(f) <= baseMax) {
      errors.push(
        `${f}: version ${versionOf(f)} is not newer than the latest on ${BASE_REF} (${baseMax}). ` +
          `Rebase on main and renumber so every new migration sorts last.`,
      )
    }
  }
}

if (errors.length) {
  console.error('✖ migration guard failed:\n')
  for (const e of errors) console.error(`  • ${e}`)
  console.error(`\nChecked ${added.length} new migration(s) against ${BASE_REF}.`)
  process.exit(1)
}

console.log(
  `✓ migration guard: ${added.length} new migration(s) OK ` +
    `(no duplicate or out-of-order versions vs ${BASE_REF}).`,
)
