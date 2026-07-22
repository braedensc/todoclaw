// check-write-caps.mjs — deterministic guard that EVERY table a user can write directly is bounded
// in VOLUME, not just in ownership. RLS (guarded by check-rls.mjs) answers "WHOSE rows can I touch";
// it says nothing about "HOW MANY / HOW BIG". A table with `insert` granted to `authenticated` and
// no per-user row cap + no size bound lets any one signed-in user mint unbounded rows or store
// unbounded blobs — a storage bomb and, for text folded into an LLM prompt, an injection surface
// (exactly the weather_cache class fixed in #310). This is a distinct security-invariant class from
// RLS; see CLAUDE.md "Security Model" rule (i).
//
// THE RULE — every table with `insert` (or `all`) granted, net of revokes, to anon / authenticated /
// public must have EITHER:
//   (a) a per-user ROW-CAP trigger  — a `before insert` trigger whose function counts the caller's
//       own rows (`count(...) ... user_id ...`) and `raise`s over a limit (the assistant_memories_cap
//       pattern), AND a SIZE CHECK — a `check (pg_column_size|char_length|octet_length(...) <= N)` on
//       the table — whenever the table has any UNBOUNDED text/jsonb/json column; OR
//   (b) an explicit entry in WRITE_CAP_ALLOWLIST below, each with a one-line justification a reviewer
//       reads. The allowlist is how a genuinely-bounded-by-other-means table (rate-limited inserts,
//       one-row-per-user unique key, owner-only insert) or a consciously-accepted gap is recorded —
//       never silently.
//
// SCOPE — read before trusting it (mirrors check-rls.mjs's "presence, not correctness" philosophy):
//   * Static text scan of supabase/migrations, comments stripped. It proves the protective DDL is
//     PRESENT; it does not execute it. A row-cap trigger with an off-by-one, or a size CHECK on the
//     wrong column, passes here — the allowlist review and code review are the backstops for
//     correctness. The value is that a NEW write-granted table with NO bound at all cannot merge
//     unnoticed, exactly as check-rls.mjs does for a missing RLS policy.
//   * "Unbounded column" = text / jsonb / json / citext, or varchar / character varying with NO
//     length. A varchar(n), numeric, uuid, timestamp etc. is already type-bounded, so a table of only
//     those needs the row cap but not a size CHECK.
//   * A "size CHECK" must be an UPPER bound (`<`, `<=`, or `between`) on a real size function
//     (pg_column_size / char_length / octet_length). A `length(x) > 0` non-empty check is NOT a size
//     cap and does not count.
//   * `public`-schema tables only (the API-reachable schema), same as check-rls.mjs.
//
// Usage:  node scripts/check-write-caps.mjs      # exit 0 = every write-granted table is bounded; 1 = offender(s)

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { argv, exit } from 'node:process'
import { loadMigrations, parseFunctions, parseTriggers, parseGrants } from './sql-scan.mjs'

const DIR = 'supabase/migrations'

// Roles reachable with a key that ships to (or is mintable by) a browser client. A write grant to any
// of these exposes the insert to end users. `public` is the catch-all role every login inherits.
const EXPOSED_ROLES = ['anon', 'authenticated', 'public']

// ─── ALLOWLIST ──────────────────────────────────────────────────────────────────────────────────
// Tables with a direct write grant that are consciously exempt from the (a) row-cap + size-CHECK
// requirement. EACH entry is a reviewed decision with a one-line reason. Two kinds live here:
//   • IN-FLIGHT — a per-user cap is being added in a parallel PR; the entry keeps CI green until it
//     lands, then SHOULD be deleted (the table then passes via rule (a) on its own).
//   • BY-DESIGN / KNOWN-GAP — bounded by other means (rate limit, one-row-per-user key, owner-only
//     insert), or an accepted risk we choose to track rather than fix right now.
// Deleting an entry that has since gained a real bound is safe — the guard warns about stale entries
// but never fails on them, so trimming this list can never turn an unrelated PR red.
export const WRITE_CAP_ALLOWLIST = {
  // IN-FLIGHT — DB-caps PR adds per-user row caps + size CHECKs to these. Remove when it merges.
  tasks: 'IN-FLIGHT (DB-caps PR): per-user row cap + title/notes size CHECK being added.',
  habits: 'IN-FLIGHT (DB-caps PR): per-user row cap + text/subtasks size CHECK being added.',
  history: 'IN-FLIGHT (DB-caps PR): per-user row cap being added (append-only completion log).',
  task_reminders: 'IN-FLIGHT (DB-caps PR): per-user/per-task reminder-row cap being added.',
  daily_state:
    'IN-FLIGHT (DB-caps PR): pg_column_size CHECK on the done/done_at/habit_done/subtask_done jsonb being added (rows already 1/user/day via PK).',
  // IN-FLIGHT — cron/push PR adds a per-user subscription cap.
  push_subscriptions:
    'IN-FLIGHT (cron/push PR): per-user subscription-row cap being added (endpoint already unique).',
  // BY-DESIGN — inserts are rate-limited, not row-capped: ai_usage_check_and_record gates writes on
  // trailing hourly/daily COUNT windows, and the only text column (`feature`) is a short fixed enum.
  ai_usage:
    'BY-DESIGN: inserts rate-limited by ai_usage_check_and_record (hourly/daily COUNT windows); no unbounded free-text column (`feature` is a short enum).',
  // BY-DESIGN — one row per user (unique/PK on user_id, upsert). KNOWN GAP: the `config` jsonb has no
  // size CHECK yet — tracked; low risk (owner-only, small settings blob).
  user_schedule:
    'BY-DESIGN: one row per user (PK/unique user_id, upsert). KNOWN GAP: config jsonb has no size CHECK yet — tracked.',
  // (invites is intentionally ABSENT: its direct authenticated INSERT grant was revoked in
  // 20260713020000_invites_owner_only_mint — minting is owner-only now — so it has no write grant to
  // bound. The guard's stale-entry warning flagged an earlier over-seeded entry here.)
  //
  // KNOWN GAP — a backup is a full snapshot jsonb with no per-user cap and no size CHECK. Accepted and
  // TRACKED (a follow-up will cap backups/user + bound the snapshot); listed so it is never silent.
  backups:
    'KNOWN GAP (tracked): full-snapshot jsonb, no per-user cap or size CHECK yet — a follow-up will bound both.',
}

// ─── column + size-check detection ──────────────────────────────────────────────────────────────
const UNBOUNDED_TYPE_RE = /^(text|jsonb|json|citext|(?:character\s+varying|varchar)(?!\s*\())/i
// A real size cap: a size function whose value is upper-bounded. Restricted to the canonical size
// functions (NOT bare `length`, which is used for non-size checks like `length(btrim(tz)) > 0`), and
// requires an upper-bound comparator close after the call so a lower-bound check never counts. (The
// comparator group has no trailing \b: `<=`/`<` end in a non-word char, so a \b there would never
// match; `between` carries its own word boundaries.)
const SIZE_CHECK_RE =
  /\b(pg_column_size|char_length|octet_length)\s*\([\s\S]{0,120}?(<=|<|\bbetween\b)/i

// Balanced-paren body of the FIRST `create table [if not exists] [public.]<name> ( … )`, or null.
function createTableBody(sql, table) {
  const head = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:"?public"?\\.)?"?${table}"?\\s*\\(`,
    'i',
  )
  const m = head.exec(sql)
  if (!m) return null
  let depth = 0
  const start = m.index + m[0].length - 1 // at the opening '('
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    else if (sql[i] === ')') {
      depth--
      if (depth === 0) return sql.slice(start + 1, i)
    }
  }
  return null
}

// Top-level (paren-depth 0) definitions of a create-table body — one per column / table constraint.
function topLevelDefs(body) {
  const defs = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      defs.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) defs.push(cur.trim())
  return defs
}

// Column names whose declared type is unbounded. Skips table-level constraint clauses.
function unboundedColumns(body) {
  const cols = []
  for (const def of topLevelDefs(body)) {
    const first = def.split(/\s+/)[0]?.toLowerCase()
    if (
      ['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude', 'like'].includes(first)
    ) {
      continue
    }
    const rest = def.slice(def.split(/\s+/)[0].length).trim() // the type + modifiers
    if (UNBOUNDED_TYPE_RE.test(rest)) cols.push(first)
  }
  return cols
}

// ─── Core scan ────────────────────────────────────────────────────────────────────────────────
// Returns Map<table, info> for every currently-live public table with a direct write grant assessed.
export function scanWriteCaps(dir = DIR) {
  const { files, perFile, all } = loadMigrations(dir)

  const onlyPublic = (schema, name) =>
    schema && schema.toLowerCase() !== 'public' ? null : name.toLowerCase()

  // Table lifecycle, resolved per file so the error can name the creating migration.
  const created = new Map() // table -> file that created it
  const dropped = new Set()
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const sql = perFile[i]
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi,
    )) {
      const t = onlyPublic(m[1], m[2])
      if (t && !created.has(t)) created.set(t, file)
    }
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
      const t = onlyPublic(m[1], m[2])
      if (t) dropped.add(t)
    }
  }

  // Net write grant per table: grant insert/all adds the exposed role, revoke insert/all removes it.
  const writeRoles = new Map()
  for (const g of parseGrants(all)) {
    if (g.kind !== 'table') continue
    const table = onlyPublic(g.schema, g.name)
    if (!table) continue
    const isWrite = /\ball\b/.test(g.privs) || /\binsert\b/.test(g.privs)
    if (!isWrite) continue
    const targeted = g.roles.filter((r) => EXPOSED_ROLES.includes(r))
    if (!targeted.length) continue
    if (!writeRoles.has(table)) writeRoles.set(table, new Set())
    const set = writeRoles.get(table)
    if (g.action === 'grant') targeted.forEach((r) => set.add(r))
    else targeted.forEach((r) => set.delete(r))
  }

  // Trigger-function bodies (last definition wins) and per-user row-cap tables.
  const fnBody = new Map()
  for (const f of parseFunctions(all)) if (f.returnsTrigger) fnBody.set(f.name, f.body)
  const rowCapTables = new Set()
  for (const t of parseTriggers(all)) {
    if (t.timing !== 'before' || !/\binsert\b/.test(t.events)) continue
    const body = fnBody.get(t.fn)
    if (body && /\bcount\s*\(/.test(body) && /\braise\b/.test(body) && /user_id/.test(body)) {
      rowCapTables.add(t.table)
    }
  }

  const info = new Map()
  for (const [table, file] of created) {
    if (dropped.has(table)) continue
    const roles = [...(writeRoles.get(table) ?? [])]
    const body = createTableBody(all, table) ?? ''
    const unbounded = unboundedColumns(body)
    // Size CHECK either inline in the create-table body or in an `alter table <table> … check(...)`.
    const alterChecks = [
      ...all.matchAll(
        new RegExp(
          `alter\\s+table\\s+(?:only\\s+)?(?:"?public"?\\.)?"?${table}"?[^;]*?check\\s*\\([^;]*?\\)`,
          'gi',
        ),
      ),
    ]
      .map((x) => x[0])
      .join(' ')
    const hasSizeCheck = SIZE_CHECK_RE.test(body) || SIZE_CHECK_RE.test(alterChecks)
    info.set(table, {
      table,
      file,
      writeGranted: roles.length > 0,
      writeRoles: roles,
      hasRowCap: rowCapTables.has(table),
      unboundedColumns: unbounded,
      hasSizeCheck,
      // Bounded via rule (a): a per-user row cap AND (no unbounded column OR a size CHECK).
      bounded: rowCapTables.has(table) && (unbounded.length === 0 || hasSizeCheck),
    })
  }
  return info
}

// Apply the allowlist: offenders = write-granted, unbounded, not allowlisted. Also reports stale
// allowlist entries (allowlisted but no longer needing it) as non-fatal notices.
export function findWriteCapOffenders(dir = DIR, allowlist = WRITE_CAP_ALLOWLIST) {
  const info = scanWriteCaps(dir)
  const offenders = []
  for (const rec of info.values()) {
    if (!rec.writeGranted || rec.bounded) continue
    if (Object.prototype.hasOwnProperty.call(allowlist, rec.table)) continue
    offenders.push(rec)
  }
  const staleAllowlist = Object.keys(allowlist).filter((t) => {
    const rec = info.get(t)
    return !rec || !rec.writeGranted || rec.bounded
  })
  return {
    info,
    offenders: offenders.sort((a, b) => a.table.localeCompare(b.table)),
    staleAllowlist,
  }
}

function reason(rec) {
  if (!rec.hasRowCap && rec.unboundedColumns.length && !rec.hasSizeCheck) {
    return `no per-user row-cap trigger and no size CHECK on: ${rec.unboundedColumns.join(', ')}`
  }
  if (!rec.hasRowCap) return 'no per-user row-cap trigger'
  return `no size CHECK on unbounded column(s): ${rec.unboundedColumns.join(', ')}`
}

function runCli(dir = DIR) {
  const { info, offenders, staleAllowlist } = findWriteCapOffenders(dir)
  const granted = [...info.values()].filter((r) => r.writeGranted).length

  for (const t of staleAllowlist) {
    console.warn(
      `⚠ WRITE_CAP_ALLOWLIST["${t}"] looks stale — the table now has a bound (or no write grant). ` +
        'Delete the allowlist entry so it stays honest.',
    )
  }

  if (offenders.length) {
    console.error('✖ Volume-bound guard failed — write-granted table(s) with no per-user cap:\n')
    for (const rec of offenders) {
      console.error(`  • public.${rec.table}  (created in ${rec.file}) — ${reason(rec)}`)
      console.error(`      granted insert to: ${rec.writeRoles.join(', ')}`)
    }
    console.error(
      '\nRLS bounds WHOSE rows a user touches, not HOW MANY / HOW BIG. Any table a user can insert\n' +
        'into needs a per-user cap. Add EITHER:\n' +
        '  (a) a `before insert` row-cap trigger (count the caller’s own rows, raise over a limit;\n' +
        '      see assistant_memories_cap) AND a `check (pg_column_size|char_length(...) <= N)` on any\n' +
        '      unbounded text/jsonb column; OR\n' +
        '  (b) an entry in WRITE_CAP_ALLOWLIST (scripts/check-write-caps.mjs) with a one-line reason.',
    )
    exit(1)
  }

  console.log(
    `✓ Volume-bound guard: all ${granted} write-granted public table(s) are bounded ` +
      '(per-user cap + size CHECK) or allowlisted with a reason.',
  )
}

// Run as a CLI only when invoked directly (not when imported by the test suite). realpath handles the
// worktree symlink layout where argv[1] and the module URL differ only by a symlinked path segment.
function invokedAsScript() {
  if (!argv[1]) return false
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return argv[1] === fileURLToPath(import.meta.url)
  }
}
if (invokedAsScript()) runCli()
