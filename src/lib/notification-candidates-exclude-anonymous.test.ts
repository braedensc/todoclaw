// notification-candidates-exclude-anonymous.test.ts — CI tripwire that the proactive dispatcher's
// candidate query excludes anonymous auth users (TOD-84). notification_candidates() is a
// service_role-only DEFINER RPC that the dispatch loop (supabase/functions/dispatch-messages) reads
// once per hourly tick; a guest row leaking through would reach precheckForUser/recordUsageForUser
// and move the authenticated AI ledger. Policy is guests get NO proactive AI (their interactive
// spend is a separate, isolated ledger — TOD-47/TOD-50), so this test pins the exclusion at the
// row-selection layer. A later migration that re-creates notification_candidates() from a stale
// definition would silently drop the fence, so this finds the LATEST definition across all
// migrations (like task-activity-retention.test.ts) and asserts on that.
//
// Same ?raw-text approach as the other migration-scanning tests: tsc's composite projects forbid
// importing across the src/ ↔ supabase boundary, so the SQL comes in as text.
import { describe, expect, it } from 'vitest'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CREATE_MARKER = 'create or replace function public.notification_candidates()'

/** The latest definition of notification_candidates() across all migrations (timestamped
 *  filenames sort chronologically), sliced from its CREATE down to the closing dollar-quote. */
function latestDefinition(): { file: string; body: string } {
  const files = Object.keys(migrations)
    .filter((file) => (migrations[file] ?? '').includes(CREATE_MARKER))
    .sort()
  const file = files.at(-1)
  if (file === undefined) throw new Error('no migration defines notification_candidates()')
  const source = migrations[file] ?? ''
  const start = source.lastIndexOf(CREATE_MARKER)
  const end = source.indexOf('$$;', start)
  expect(end, `unterminated function body in ${file}`).toBeGreaterThan(start)
  return { file, body: source.slice(start, end) }
}

describe('notification_candidates (latest definition) excludes anonymous users', () => {
  const { file, body } = latestDefinition()

  it('carries a NOT EXISTS filter on auth.users.is_anonymous', () => {
    // A guest row (auth.users.is_anonymous = true) must not appear in the returned candidate set —
    // otherwise the dispatch loop reaches precheckForUser and moves the authenticated AI ledger.
    // Assert on the SQL shape rather than reasoning about behavior at runtime. `[\s\S]*?` tolerates
    // interleaved SQL comments/whitespace between `not exists (` and the joined predicate.
    expect(body, `${file}: notification_candidates() lost its anonymous-user exclusion`).toMatch(
      /not\s+exists\s*\([\s\S]*?select\s+1\s+from\s+auth\.users\s+\w+[\s\S]*?\w+\.id\s*=\s*us\.user_id[\s\S]*?\w+\.is_anonymous\s*=\s*true[\s\S]*?\)/i,
    )
  })

  it('keeps the enabled + ≥1-subscription gates from the original definition', () => {
    // Byte-for-byte behavior for authenticated users is an acceptance criterion — the new filter
    // is additive, so the two original gates must still be present in the same shape.
    expect(body).toMatch(
      /coalesce\(\(us\.config\s*->\s*'notifications'\s*->>\s*'enabled'\)::boolean,\s*false\)\s*=\s*true/,
    )
    expect(body).toMatch(
      /exists\s*\(\s*select\s+1\s+from\s+public\.push_subscriptions\s+ps\s+where\s+ps\.user_id\s*=\s*us\.user_id\s*\)/i,
    )
  })

  it('stays service_role-only (fence unchanged)', () => {
    // The DEFINER-scope guard (scripts/check-definer-grants.mjs) only classifies functions granted
    // to an EXPOSED role (anon/authenticated/public). Keeping this service_role-only means the
    // allowlist stays untouched. A migration that widens the grant is what would require a
    // reviewed scoping entry — this test pins the fence so that widening is a deliberate act.
    const source = migrations[file] ?? ''
    expect(source).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.notification_candidates\(\)\s+to\s+service_role/i,
    )
    expect(source).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.notification_candidates\(\)\s+to\s+(anon|authenticated|public)/i,
    )
  })
})
