// check-schema-drift.mjs — catches the drift direction `migration-drift.yml`'s dry-run cannot see:
// objects that exist in PRODUCTION but in no migration, i.e. changes made out-of-band (dashboard SQL
// editor, a manual psql session) that a from-scratch local rebuild would never reproduce.
//
// WHY A SECOND CHECK EXISTS. The original drift job asks `supabase db push --dry-run`: "does prod
// have every migration the repo does?". That is one-directional by construction — it enumerates repo
// files and looks for them in prod's `schema_migrations`. An object created straight on prod is in no
// migration file, so there is nothing for it to look for and the job stays green forever. That is
// exactly how `public.rls_auto_enable()` + its `ensure_rls` event trigger — a live RLS backstop —
// ran in prod for months while `grep -rn rls_auto_enable supabase/` returned nothing (found
// 2026-08-27, checked in by 20260826120000). Prod had 71 postgres-owned public functions; a clean
// build had 70. The consequence is worse than one stray function: it means local and CI are not a
// faithful rebuild of production, so every guard that runs against a locally-built stack is judging
// a database that is not the one users touch.
//
// WHY NOT `supabase db diff --linked`. It looks like the obvious tool and it is NOT reliable here.
// Measured on this repo 2026-08-27, twice, against a clean local stack: `db diff --linked --schema
// public` printed "No schema changes found" while prod demonstrably carried both the function and
// the event trigger. (The same migra-backed diff run against a LOCAL database does report an
// out-of-band function and event trigger, so the gap is in the `--linked` path, not migra itself.)
// It also emits spurious `create or replace function` noise for functions that have not changed —
// false positives in a gate that must be trusted to stay quiet. So this check does not diff DDL at
// all: it compares a normalized INVENTORY of object identities, which is cheap, stable, and has no
// opinion about formatting.
//
// SCOPE — what is compared, and why the signal is clean. `supabase_admin`-owned objects (the Supabase
// platform's own functions and event triggers) and extension-owned objects (`pg_depend.deptype='e'`)
// are excluded, leaving only objects THIS project is responsible for. Validated 2026-08-27: prod
// yielded 133 identities, a clean local build 131, and the difference was exactly the two known
// out-of-band objects — zero noise in either direction.
//
// Compared: `public` functions (name + identity arguments, so overloads stay distinct), non-platform
// event triggers, `public` tables with their RLS flag, and `public` policies. NOT compared: column
// types, defaults, indexes, constraints. This is a presence/absence inventory — it answers "does an
// object exist here that exists nowhere in the repo", not "is every column identical". A migration
// that alters a column in place is the other job's territory.
//
// Env:
//   PROD_DB_URL   connection string for production (the session pooler URL — GitHub runners are
//                 IPv4-only and Supabase direct connections are IPv6, see backup.yml).
//   LOCAL_DB_URL  connection string for a stack freshly built from supabase/migrations.
//
// Usage:  PROD_DB_URL=… LOCAL_DB_URL=… node scripts/check-schema-drift.mjs
//   exit 0 = prod contains nothing the repo lacks; exit 1 = out-of-band object(s) found.

import { Client } from 'pg'

// One normalized inventory per database. `order by` is applied after the union so both sides sort
// identically regardless of catalog order. The predicate is a trusted constant — never user input.
const INVENTORY_SQL = `
  select 'function|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as obj
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proowner::regrole::text <> 'supabase_admin'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'event_trigger|' || evtname
    from pg_event_trigger
   where evtowner::regrole::text <> 'supabase_admin'
  union all
  select 'table|' || c.relname || '|rls=' || c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  union all
  select 'policy|' || tablename || '|' || policyname
    from pg_policies
   where schemaname = 'public'
  order by 1
`

// Supabase's pooler requires TLS; a local stack does not offer it. Key off the host rather than
// making the caller thread an extra flag through CI.
function sslFor(url) {
  return /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
}

async function inventory(label, url) {
  const client = new Client({ connectionString: url, ssl: sslFor(url) })
  try {
    await client.connect()
  } catch (err) {
    console.error(`✖ schema drift: could not connect to ${label}: ${err.message}`)
    process.exit(1)
  }
  try {
    const { rows } = await client.query(INVENTORY_SQL)
    return new Set(rows.map((r) => r.obj))
  } finally {
    await client.end()
  }
}

const PROD_URL = process.env.PROD_DB_URL
const LOCAL_URL = process.env.LOCAL_DB_URL

if (!PROD_URL || !LOCAL_URL) {
  console.error('✖ schema drift: PROD_DB_URL and LOCAL_DB_URL are both required.')
  process.exit(1)
}

const prod = await inventory('production', PROD_URL)
const local = await inventory('the local build', LOCAL_URL)

// A guard that compares against an empty set would pass vacuously. Refuse to report "clean" unless
// both sides actually produced a schema.
if (local.size === 0 || prod.size === 0) {
  console.error(
    `✖ schema drift: inconclusive — an inventory came back empty (prod ${prod.size}, ` +
      `local ${local.size}). Refusing to report clean.`,
  )
  process.exit(1)
}

const onlyProd = [...prod].filter((o) => !local.has(o)).sort()
const onlyLocal = [...local].filter((o) => !prod.has(o)).sort()

// Prod missing something the repo has is the OTHER job's signal (its dry-run names the exact pending
// migrations). Report it for context, but do not fail on it — two jobs opening issues about one
// deploy lag is noise.
if (onlyLocal.length) {
  console.warn(
    `⚠ ${onlyLocal.length} object(s) in the repo build are absent from prod — usually a deploy that ` +
      `has not run yet; the "Check prod is up to date" job owns this signal:`,
  )
  for (const o of onlyLocal) console.warn(`  • ${o}`)
  console.warn('')
}

if (onlyProd.length) {
  console.error(
    `✖ Schema drift: ${onlyProd.length} object(s) exist in PRODUCTION but in no migration:\n`,
  )
  for (const o of onlyProd) console.error(`  • ${o}`)
  console.error(
    '\nThese were created out-of-band (dashboard SQL editor or a manual session). A from-scratch\n' +
      'local rebuild does NOT reproduce them, so local and CI are not a faithful rebuild of\n' +
      'production. Either add a migration that recreates each one — idempotent, so it is a no-op\n' +
      'against prod (see supabase/migrations/20260826120000_rls_auto_enable_event_trigger.sql) —\n' +
      'or drop it from prod if it is dead.',
  )
  process.exit(1)
}

console.log(
  `✓ Schema drift: production carries no object absent from the repo ` +
    `(${prod.size} identities compared).`,
)
