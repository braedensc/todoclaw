// check-rls.mjs — deterministic guard that EVERY table exposed to the API has Row Level Security
// enabled. RLS is TodoClaw's core multi-tenant boundary (CLAUDE.md "Security Model",
// docs/ARCHITECTURE.md): the public anon key ships in the client bundle, so a `public` table
// WITHOUT RLS is readable/writable by anyone on the internet holding that (public) key. This check
// fails the build the moment a migration adds a `public` table but forgets `enable row level
// security`, closing the one discipline the whole access model depends on.
//
// SCOPE — read this before trusting it:
//   * It only asserts RLS is ENABLED. It does NOT verify the policies are correct — a table with
//     RLS on plus a `using (true)` policy would pass here yet still leak. That class is caught by
//     the live companion (scripts/check-rls-live.mjs), which queries the real database and probes
//     the anon path. This static check is the cheap first line: no database, no deps, milliseconds.
//   * Only the `public` schema is judged — the only schema PostgREST exposes by default. Tables in
//     `auth`, `extensions`, `storage`, private schemas, etc. are Supabase-managed / not
//     API-reachable and are intentionally skipped.
//   * Parses migration SQL textually with comments AND single-quoted string literals stripped
//     first, so a `create table` inside a comment (notably the `-- down:` reversal blocks every
//     migration documents) or inside a string (an event trigger's `when tag in ('CREATE TABLE AS')`)
//     is never counted.
//
// Usage:  node scripts/check-rls.mjs      # exit 0 = every public table has RLS; 1 = offender(s)

import { readdirSync, readFileSync } from 'node:fs'

const DIR = 'supabase/migrations'

// Strip SQL comments so DDL mentioned inside a comment (e.g. the `-- down:` reversal blocks) is
// never mistaken for a real statement. Block comments first, then line comments to end-of-line.
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
}

// Then strip single-quoted string literals, so SQL *named inside a string* is not read as DDL. The
// case that forced this: an event trigger's `when tag in ('CREATE TABLE', 'CREATE TABLE AS', …)`
// lists command tags as literals, and `'CREATE TABLE AS'` matched CREATE_RE as a table literally
// named `as` (20260826120000). `''` is Postgres's escape for a quote inside a literal, so it is
// consumed as part of the run rather than ending it.
//
// ORDER MATTERS: comments are stripped FIRST. A comment containing a lone apostrophe ("the user's
// row") would otherwise mis-pair the quotes and swallow real DDL after it. Verified against every
// migration in the tree: none performs DDL inside a single-quoted literal (no `execute '…'`), so
// nothing the guard should credit is lost — dollar-quoted bodies ($$…$$) are untouched.
function stripStrings(sql) {
  return sql.replace(/'(?:[^']|'')*'/g, ' ')
}

// A table needs RLS iff it lives in `public` — either explicitly (`public.x`) or unqualified (which
// defaults to public). Returns the bare lowercased name, or null to skip a non-public schema.
function publicTable(schema, name) {
  if (schema && schema.toLowerCase() !== 'public') return null
  return name.toLowerCase()
}

const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi
const DROP_RE = /drop\s+table\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi
const RLS_RE =
  /alter\s+table\s+(?:only\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const created = new Map() // table -> migration file that created it (for a helpful error)
const dropped = new Set() // tables a later migration drops (no longer need RLS)
const rlsOn = new Set() // tables that `enable row level security` somewhere

for (const file of files) {
  const sql = stripStrings(stripComments(readFileSync(`${DIR}/${file}`, 'utf8')))
  for (const m of sql.matchAll(CREATE_RE)) {
    const t = publicTable(m[1], m[2])
    if (t && !created.has(t)) created.set(t, file)
  }
  for (const m of sql.matchAll(DROP_RE)) {
    const t = publicTable(m[1], m[2])
    if (t) dropped.add(t)
  }
  for (const m of sql.matchAll(RLS_RE)) {
    const t = publicTable(m[1], m[2])
    if (t) rlsOn.add(t)
  }
}

const live = [...created.entries()].filter(([t]) => !dropped.has(t))
const offenders = live.filter(([t]) => !rlsOn.has(t)).sort()

if (offenders.length) {
  console.error('✖ RLS guard failed — public table(s) created without Row Level Security:\n')
  for (const [t, file] of offenders) console.error(`  • public.${t}  (created in ${file})`)
  console.error(
    '\nEvery table in the public schema is reachable with the public anon key. Add\n' +
      '  alter table public.<name> enable row level security;\n' +
      'plus owner-scoped policies to the migration, or the table is open to the internet.',
  )
  process.exit(1)
}

console.log(
  `✓ RLS guard: all ${live.length} public table(s) across ${files.length} migration(s) ` +
    'enable row level security.',
)
