// check-definer-grants.mjs — deterministic guard that no SECURITY DEFINER function reachable by end
// users slips in without a human classifying whether its writes are scoped to the caller.
//
// WHY THIS CLASS EXISTS, SEPARATE FROM RLS. A SECURITY DEFINER function runs with the DEFINER's
// privileges and BYPASSES the RLS of the tables it touches — that is the whole point of using one
// (reach a global ledger, a service-only table). So RLS, the guard for "whose rows", is by
// construction NOT protecting the tables a DEFINER function writes. The invariant that has to hold
// instead is that the function scopes its own writes to `auth.uid()` (or writes only a table with no
// per-user ownership by deliberate design). weather_cache_put (#310) is the cautionary tale: a
// DEFINER function granted to `authenticated` that wrote a GLOBAL table with only an
// `auth.uid() is null` check — any signed-in user could poison any location's cached weather, which
// then reached another user's LLM prompt. Nothing flagged it at review time. See CLAUDE.md "Security
// Model" rule (ii).
//
// THE APPROACH (pragmatic — static SQL-body scoping analysis is unreliable). We do NOT try to prove
// scoping from the function body. Instead we maintain a REVIEWED ALLOWLIST of every DEFINER function
// net-granted to an exposed role (anon / authenticated / public), each entry recording the human's
// verdict ("writes scoped to auth.uid(): yes/no/read-only" + a note). CI fails the moment a migration
// introduces a NEW such grant that is not in the allowlist — forcing a reviewer to open the function,
// classify it, and add the entry. That is exactly the review step that would have caught
// weather_cache_put. Adding the entry is the "I looked, here's why it's safe" record.
//
// SCOPE: text scan of supabase/migrations, comments stripped, revokes honored (so #310's
// `revoke execute … from authenticated` correctly drops weather_cache from the set). A function is
// "DEFINER" if ANY of its definitions is `security definer` (conservative — never hides a DEFINER
// overload behind an INVOKER one). Keyed by function NAME (overloads share one reviewed entry).
//
// Usage:  node scripts/check-definer-grants.mjs   # exit 0 = every DEFINER-granted-to-users fn is classified; 1 = a new one

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { argv, exit } from 'node:process'
import { loadMigrations, parseFunctions, parseGrants } from './sql-scan.mjs'

const DIR = 'supabase/migrations'

// Roles a signed-in (or pre-login) end user can act as. A DEFINER function's EXECUTE grant to any of
// these makes it user-reachable — the case this guard governs. service_role (server-only) is NOT here.
const EXPOSED_ROLES = ['anon', 'authenticated', 'public']

// ─── ALLOWLIST ──────────────────────────────────────────────────────────────────────────────────
// Every SECURITY DEFINER function net-granted to an exposed role, with the reviewer's scoping
// verdict. `writesScopedToAuthUid`:
//   'yes'        — the function writes, and every write is fenced to auth.uid() (own rows only).
//   'read-only'  — the function performs no INSERT/UPDATE/DELETE (nothing to scope).
//   'no'         — the function writes a table NOT scoped to the caller; the `note` MUST justify why
//                  that is acceptable (e.g. a deliberately global, non-sensitive table). This is the
//                  weather_cache_put shape — allowed only with an explicit, reviewed rationale.
// A new DEFINER-granted-to-users function absent from this map fails CI until a human adds it here.
export const DEFINER_GRANT_ALLOWLIST = {
  ai_budget_add: {
    writesScopedToAuthUid: 'yes',
    note: 'Per-user ledger (ai_user_budget_ledger) keyed on v_uid=auth.uid(); the global-pool increment (ai_budget_ledger) is bound to a caller-OWNED ai_usage row and clamped ≤$0.20/call.',
  },
  ai_budget_check: {
    writesScopedToAuthUid: 'read-only',
    note: 'Reads the budget ledgers to answer the kill-switch/sub-cap check; no writes.',
  },
  ai_user_budget_check: {
    writesScopedToAuthUid: 'read-only',
    note: 'Reads the per-user monthly ledger for the auth.uid() caller; no writes.',
  },
  app_config_get: {
    writesScopedToAuthUid: 'read-only',
    note: 'Returns the single global guardrail-config row (id=1); read-only, intentionally not user-scoped.',
  },
  chat_list_previews: {
    writesScopedToAuthUid: 'read-only',
    note: 'Reads the caller’s own chat sessions/messages (filtered by auth.uid()) for the list preview; no writes.',
  },
  chat_open_for_message: {
    writesScopedToAuthUid: 'yes',
    note: 'Inserts chat_sessions/chat_messages with user_id=auth.uid() and updates only the caller’s own messages row (fenced `where … and user_id = v_uid`).',
  },
  // Flipped INVOKER→DEFINER in #314 (ai_usage direct grants revoked; writes now go through these RPCs).
  ai_usage_check_and_record: {
    writesScopedToAuthUid: 'yes',
    note: 'Inserts ai_usage with user_id=v_uid (=auth.uid()); the rate-limit COUNT windows it reads are all fenced `where user_id = v_uid`. #314.',
  },
  ai_usage_record_tokens: {
    writesScopedToAuthUid: 'yes',
    note: 'Updates only the caller’s own usage row (`update ai_usage … where id = p_id and user_id = auth.uid()`). #314.',
  },
  // Flipped INVOKER→DEFINER alongside the reminder pipeline hardening (#311/#312).
  set_task_reminder: {
    writesScopedToAuthUid: 'yes',
    note: 'Inserts task_reminders with user_id=auth.uid(); the target task is fenced `where id = p_task_id and user_id = auth.uid()`.',
  },
  clear_task_reminder: {
    writesScopedToAuthUid: 'yes',
    note: 'Deletes only the caller’s reminders (`delete … where task_id = p_task_id and user_id = auth.uid()`).',
  },
  remove_task_reminder: {
    writesScopedToAuthUid: 'yes',
    note: 'Deletes only the caller’s reminders (`delete … where … and user_id = auth.uid()`).',
  },
  // NOT user-scoped, and that is correct: a pre-auth IP rate-limiter (#311). Granted to anon too
  // because the edge functions it guards run with verify_jwt=false.
  edge_ip_throttle: {
    writesScopedToAuthUid: 'no',
    note: 'Writes edge_ip_events — an IP-keyed rate-limit bucket (no user_id), reachable ONLY via this DEFINER fn (table has RLS on, no grants). Runs pre-auth so there is no auth.uid() to scope by; it bounds abuse and fails open. Non-sensitive throttle state. Reviewed (#311).',
  },
}

// ─── scan ───────────────────────────────────────────────────────────────────────────────────────
// Returns the sorted list of function NAMES that are (DEFINER in ≥1 definition) AND (net-granted
// EXECUTE to an exposed role).
export function definerFunctionsGrantedToUsers(dir = DIR) {
  const { all } = loadMigrations(dir)

  // A name is DEFINER if any of its definitions declares `security definer`.
  const definerNames = new Set()
  for (const f of parseFunctions(all)) {
    if (f.security === 'definer') definerNames.add(f.name)
  }

  // Net EXECUTE grant to an exposed role, per function name (grant adds, revoke removes).
  const grantedRoles = new Map()
  for (const g of parseGrants(all)) {
    if (g.kind !== 'function') continue
    const isExec = /\bexecute\b/.test(g.privs) || /\ball\b/.test(g.privs)
    if (!isExec) continue
    const targeted = g.roles.filter((r) => EXPOSED_ROLES.includes(r))
    if (!targeted.length) continue
    if (!grantedRoles.has(g.name)) grantedRoles.set(g.name, new Set())
    const set = grantedRoles.get(g.name)
    if (g.action === 'grant') targeted.forEach((r) => set.add(r))
    else targeted.forEach((r) => set.delete(r))
  }

  const out = []
  for (const [name, roles] of grantedRoles) {
    if (roles.size && definerNames.has(name)) out.push(name)
  }
  return out.sort()
}

// offenders = DEFINER-granted-to-users functions with no allowlist entry. stale = allowlist entries
// that are no longer DEFINER-granted-to-users (e.g. the grant was revoked, like weather_cache/#310).
export function findDefinerGrantOffenders(dir = DIR, allowlist = DEFINER_GRANT_ALLOWLIST) {
  const inScope = definerFunctionsGrantedToUsers(dir)
  const offenders = inScope.filter((n) => !Object.prototype.hasOwnProperty.call(allowlist, n))
  const inScopeSet = new Set(inScope)
  const staleAllowlist = Object.keys(allowlist).filter((n) => !inScopeSet.has(n))
  return { inScope, offenders, staleAllowlist }
}

function runCli(dir = DIR) {
  const { inScope, offenders, staleAllowlist } = findDefinerGrantOffenders(dir)

  for (const n of staleAllowlist) {
    console.warn(
      `⚠ DEFINER_GRANT_ALLOWLIST["${n}"] looks stale — it is no longer a DEFINER function granted ` +
        'to an exposed role (grant revoked, or no longer SECURITY DEFINER). Delete the entry.',
    )
  }

  if (offenders.length) {
    console.error(
      '✖ DEFINER-scope guard failed — SECURITY DEFINER function(s) granted to a user role with no ' +
        'reviewed scoping entry:\n',
    )
    for (const n of offenders) console.error(`  • public.${n}()`)
    console.error(
      '\nA SECURITY DEFINER function BYPASSES the RLS of the tables it writes, so RLS is not\n' +
        'protecting them — the function itself must scope its writes to auth.uid() (weather_cache_put,\n' +
        '#310, is the counter-example: a global write reachable by any user). Open each function, then\n' +
        'add an entry to DEFINER_GRANT_ALLOWLIST in scripts/check-definer-grants.mjs recording\n' +
        '`writesScopedToAuthUid: yes | no | read-only` and a one-line justification. If it writes an\n' +
        'unscoped table with no good reason, fix the function (or revoke the user grant) instead.',
    )
    exit(1)
  }

  console.log(
    `✓ DEFINER-scope guard: all ${inScope.length} SECURITY DEFINER function(s) granted to a user ` +
      'role carry a reviewed scoping entry.',
  )
}

function invokedAsScript() {
  if (!argv[1]) return false
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return argv[1] === fileURLToPath(import.meta.url)
  }
}
if (invokedAsScript()) runCli()
