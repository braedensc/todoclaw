// check-rls-live.mjs — the live-database companion to check-rls.mjs. The static check reads the
// migration TEXT; this one applies the migrations to a REAL Postgres (via `supabase start` in CI)
// and interrogates the actual database, catching what a text scan cannot:
//   A. RLS truly enabled on every public table — reflects the APPLIED schema, so drift (a manual
//      dashboard toggle, an extension-created table) shows up here, not just what the files say.
//   B. No blanket-permissive policy — a `using (true)` / `with check (true)` policy granted to
//      anon/authenticated leaves RLS "on" yet the table world-open. The static check can't read
//      policy bodies; this reads pg_policies.
//   C. RLS on but zero policies — deny-all (safe, but usually a forgotten policy). Warning only.
//   D. The anon path actually denies reads — an end-to-end probe through PostgREST with the public
//      anon key against a self-contained secured/open control PAIR (no app tables touched): the
//      secured table (RLS on, no policy) must return nothing, and the open table (no RLS) MUST
//      return its row, so the probe can never pass vacuously.
//
// Boundary: this proves anon (pre-login) cannot read, and flags world-open policies. It does NOT
// simulate one logged-in user reading another's rows — that owner-scoping (user_id = auth.uid()) is
// exercised by the golden E2E suite with real logins. A + B + the anon deny are the machine-checkable core.
//
// Env (CI sets these from `supabase status -o env`):
//   SUPABASE_DB_URL    postgres superuser URL, REQUIRED (bypasses RLS — setup/inspection only)
//   SUPABASE_URL       REST/API base (Kong), e.g. http://127.0.0.1:54321
//   SUPABASE_ANON_KEY  the PUBLIC anon JWT (same class of key the browser ships)
//
// Usage:  node scripts/check-rls-live.mjs      # exit 0 = clean, 1 = a real RLS hole

import { Client } from 'pg'

const DB_URL = process.env.SUPABASE_DB_URL
const API_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
const ANON_KEY = process.env.SUPABASE_ANON_KEY || ''

const EXPOSED_ROLES = ['anon', 'authenticated', 'public']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Public base/partitioned tables that WE own — i.e. excluding any table an installed extension
// created in public (pg_depend deptype 'e'). Those are managed by the extension, not our
// migrations, so requiring RLS on them would be a spurious failure. `predicate` is extra SQL AND-ed
// onto the WHERE (e.g. RLS on/off); it is a trusted constant here, never user input.
function ownedPublicTablesQuery(predicate) {
  return `
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and ${predicate}
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
       )
     order by 1`
}

async function fetchRest(table, { noKey = false } = {}) {
  const headers = noKey ? {} : { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
  const res = await fetch(`${API_URL}/rest/v1/${table}?select=id`, { headers })
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

// Poll the positive-control read until PostgREST has reloaded its schema cache (the NOTIFY is
// handled asynchronously), so the probe never races the reload.
async function waitForRest(table, attempts = 20) {
  let detail = 'no response'
  for (let i = 0; i < attempts; i++) {
    const r = await fetchRest(table)
    if (r.ok && Array.isArray(r.body) && r.body.length === 1) return { ok: true }
    detail = `status ${r.status}`
    await sleep(250)
  }
  return { ok: false, detail }
}

// D. End-to-end anon probe with a secured/open control pair. Setup failures downgrade to a warning
// (the probe harness couldn't be established) — only an actual BREACH fails the build, so a flaky
// schema-reload can never spuriously break CI. The catalog checks A/B are the deterministic core.
async function runAnonProbe(client, failures, warnings) {
  const SECURED = '_rls_probe_secured'
  const OPEN = '_rls_probe_open'
  await client.query(`drop table if exists public.${SECURED}, public.${OPEN}`)
  try {
    // Secured: anon is GRANTed select, so RLS (on, no policy -> deny-all) is the ONLY thing that can
    // hide the row — isolating RLS as the cause of an empty read.
    await client.query(`create table public.${SECURED} (id int primary key, secret text)`)
    await client.query(`grant select on public.${SECURED} to anon`)
    await client.query(`alter table public.${SECURED} enable row level security`)
    await client.query(`insert into public.${SECURED} values (1, 'top-secret')`)
    // Open: RLS OFF + anon select grant -> the row IS visible. Positive control: proves the probe
    // can read through PostgREST when nothing blocks it, so the empty secured read is meaningful.
    await client.query(`create table public.${OPEN} (id int primary key, secret text)`)
    await client.query(`grant select on public.${OPEN} to anon`)
    await client.query(`insert into public.${OPEN} values (1, 'visible')`)
    await client.query(`notify pgrst, 'reload schema'`)

    const open = await waitForRest(OPEN)
    if (!open.ok) {
      warnings.push(
        `anon probe inconclusive — positive control public.${OPEN} never became readable ` +
          `(${open.detail}); PostgREST schema reload may be disabled. Catalog checks still ran.`,
      )
      return
    }
    const leaked = (r) =>
      r.status >= 200 && r.status < 300 && Array.isArray(r.body) && r.body.length > 0
    // The assertion: the RLS-protected table must return NOTHING to the anon key.
    const secured = await fetchRest(SECURED)
    if (leaked(secured)) {
      failures.push(
        `anon probe: RLS BREACH — the anon key read ${secured.body.length} row(s) from ` +
          `RLS-protected public.${SECURED}. The anon + RLS pipeline is NOT enforcing.`,
      )
    }
    // And with NO apikey at all: older gateways reject the request outright (401), newer Supabase
    // CLI stacks forward it as anon and let RLS decide — both fine. Judge by data, not status:
    // the only unacceptable outcome is the row coming back.
    const noKey = await fetchRest(SECURED, { noKey: true })
    if (leaked(noKey)) {
      failures.push(
        `anon probe: RLS BREACH — a request with NO apikey read ${noKey.body.length} row(s) from ` +
          `RLS-protected public.${SECURED}.`,
      )
    }
  } finally {
    await client.query(`drop table if exists public.${SECURED}, public.${OPEN}`)
    await client.query(`notify pgrst, 'reload schema'`)
  }
}

async function main() {
  if (!DB_URL) {
    console.error(
      '✖ SUPABASE_DB_URL is not set. In CI it comes from `supabase status -o env`; ' +
        'locally, export it before running.',
    )
    process.exit(1)
  }
  const failures = []
  const warnings = []
  const client = new Client({ connectionString: DB_URL })
  await client.connect()
  try {
    // A. Every public table WE own has RLS enabled (in the real, applied schema).
    const noRls = await client.query(ownedPublicTablesQuery('not c.relrowsecurity'))
    for (const row of noRls.rows) {
      failures.push(`public.${row.relname}: RLS is DISABLED in the live database.`)
    }

    // B. No blanket-`true` policy exposed to anon/authenticated/public. pg_policies renders USING as
    // `qual` and WITH CHECK as `with_check`; `using (true)` stores the literal text `true`.
    const openPolicies = await client.query(
      `select tablename, policyname, cmd, roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and (qual = 'true' or with_check = 'true')`,
    )
    for (const p of openPolicies.rows) {
      const roles = Array.isArray(p.roles) ? p.roles : []
      if (!roles.some((r) => EXPOSED_ROLES.includes(r))) continue
      const who = roles.join(', ')
      if (p.qual === 'true' && (p.cmd === 'SELECT' || p.cmd === 'ALL')) {
        failures.push(
          `public.${p.tablename}: policy "${p.policyname}" is USING (true) for [${who}] — every ` +
            `row is readable by those roles (world-readable via the anon key).`,
        )
      } else {
        warnings.push(
          `public.${p.tablename}: policy "${p.policyname}" (${p.cmd}) has an unrestricted ` +
            `${p.qual === 'true' ? 'USING' : 'WITH CHECK'} (true) for [${who}] — confirm this is intended.`,
        )
      }
    }

    // C. RLS on but no policies at all = deny-all (safe, but usually a forgotten policy) -> warn.
    const noPolicy = await client.query(
      ownedPublicTablesQuery(
        `c.relrowsecurity and not exists (
           select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
         )`,
      ),
    )
    for (const row of noPolicy.rows) {
      warnings.push(
        `public.${row.relname}: RLS enabled but NO policies — deny-all (safe, but likely a missing policy).`,
      )
    }

    // D. End-to-end anon probe (skipped without an anon key).
    if (ANON_KEY) {
      await runAnonProbe(client, failures, warnings)
    } else {
      warnings.push(
        'SUPABASE_ANON_KEY not set — skipped the end-to-end anon REST probe (A–C still ran).',
      )
    }
  } finally {
    await client.end()
  }

  for (const w of warnings) console.warn(`⚠ ${w}`)
  if (failures.length) {
    console.error('\n✖ RLS live check FAILED:')
    for (const f of failures) console.error(`  • ${f}`)
    process.exit(1)
  }
  console.log(
    '✓ RLS live check: every public table enforces RLS, no blanket-open policy, anon reads denied.',
  )
}

main().catch((err) => {
  console.error(`✖ RLS live check crashed: ${err.message}`)
  process.exit(1)
})
