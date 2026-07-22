// task-activity-retention.test.ts — CI tripwire for the task_activity self-prune (#307).
//
// task_activity is written by the SECURITY DEFINER log_task_activity() trigger on every task
// write, so grants can't bound it — and task UPDATES carry no volume cap (#312 caps rows, not
// updates). The ONLY things keeping the log finite and quiet are inside the trigger function
// itself: the newest-v_keep retention DELETE and the todoclaw.suppress_activity GUC guard for
// restore_backup's bulk path. A later migration that re-creates log_task_activity() from a stale
// definition would drop both SILENTLY, so this test finds the LATEST definition across ALL
// migrations (a new file that re-creates the function is automatically the one under test) and
// pins the invariants there. The runnable end-to-end proof is the psql drill:
// scripts/db-drills/task-activity-retention.sql.
//
// Same ?raw-text approach as db-write-caps pinning: tsc's composite projects forbid importing
// across the src/ ↔ supabase boundary, so the SQL and the edge-function source come in as text.
import { describe, expect, it } from 'vitest'
import chatContext from '../../supabase/functions/_shared/chat-context.ts?raw'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CREATE_MARKER = 'create or replace function public.log_task_activity()'

/** The latest definition of log_task_activity() across all migrations (timestamped filenames
 *  sort chronologically), sliced from its CREATE down to the closing dollar-quote. */
function latestDefinition(): { file: string; body: string } {
  const files = Object.keys(migrations)
    .filter((file) => (migrations[file] ?? '').includes(CREATE_MARKER))
    .sort()
  const file = files.at(-1)
  if (file === undefined) throw new Error('no migration defines log_task_activity()')
  const source = migrations[file] ?? ''
  const start = source.lastIndexOf(CREATE_MARKER)
  const end = source.indexOf('$$;', start)
  expect(end, `unterminated function body in ${file}`).toBeGreaterThan(start)
  return { file, body: source.slice(start, end) }
}

describe('task_activity retention (latest log_task_activity definition)', () => {
  const { file, body } = latestDefinition()

  it('keeps the newest-500-per-user retention DELETE', () => {
    const keep = /v_keep\s+constant\s+int\s*:=\s*(\d+)/.exec(body)?.[1]
    expect(keep, `${file}: v_keep constant missing — retention dropped?`).toBeDefined()
    expect(Number(keep)).toBe(500)
    expect(body).toMatch(
      /delete from public\.task_activity\s+where user_id = new\.user_id\s+and id not in \(\s*select id from public\.task_activity\s+where user_id = new\.user_id\s+order by created_at desc\s+limit v_keep/,
    )
  })

  it("never raises — blocking the log would abort the user's task write", () => {
    // RAISE NOTICE/WARNING would be fine; the abort forms are what must never appear.
    expect(body).not.toMatch(/raise\s+(exception|sqlstate|')/i)
  })

  it('keeps the restore_backup bulk-suppress GUC guard', () => {
    expect(body).toContain("current_setting('todoclaw.suppress_activity', true)")
  })

  it('chat-context reads a window no wider than the retention', () => {
    const limit = /\.from\('task_activity'\)[\s\S]{0,600}?\.limit\((\d+)\)/.exec(chatContext)?.[1]
    expect(limit, 'chat-context task_activity read lost its .limit()').toBeDefined()
    expect(Number(limit)).toBeLessThanOrEqual(500)
  })
})
