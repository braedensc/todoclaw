// Deno tests pinning the write-volume caps (the guardrails.test.ts pattern): literal pins so a
// drive-by edit to a cap is a conscious, test-visible act, plus the cross-invariants that make
// the numbers coherent with each other and with the code that relies on them. The SQL side of
// the same numbers is pinned by src/lib/db-write-caps.test.ts over the migration text.
// Run: deno test --no-check supabase/functions/_shared/write-caps.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import {
  DB_BACKUPS_MAX,
  DB_BACKUP_DATA_MAX_BYTES,
  DB_DAILY_STATE_DATE_WINDOW_DAYS,
  DB_HABITS_LIVE_MAX,
  DB_HABITS_TOTAL_MAX,
  DB_HABIT_TEXT_MAX,
  DB_HISTORY_MAX,
  DB_HISTORY_TEXT_MAX,
  DB_REMINDERS_PER_TASK_MAX,
  DB_REMINDERS_PER_USER_MAX,
  DB_TASKS_LIVE_MAX,
  DB_TASKS_TOTAL_MAX,
  DB_TASK_TEXT_MAX,
  HABITS_FETCH_LIMIT,
  REMINDERS_FETCH_LIMIT,
  TASKS_FETCH_LIMIT,
} from './write-caps.ts'
import { MAX_HABITS_SHOWN, MAX_TASKS_SHOWN } from './chat-prompt.ts'

Deno.test('text caps: 2000 chars, matching the BabyClaw capability bound', () => {
  // capabilities/tasks.ts create_task/update_task validate text with z.string().max(2000). The DB
  // CHECK must never reject what a capability accepted, so the three text caps pin to that number.
  assertEquals(DB_TASK_TEXT_MAX, 2000)
  assertEquals(DB_HABIT_TEXT_MAX, 2000)
  // history.text is a snapshot of task text at completion — same bound or set_task_done could
  // fail on a task the caps allowed.
  assertEquals(DB_HISTORY_TEXT_MAX, DB_TASK_TEXT_MAX)
})

Deno.test('row caps: live tier under total tier (soft-delete tables)', () => {
  // The LIVE cap is the user-facing bound (freeable by deleting); the TOTAL cap bounds storage
  // against create→soft-delete churn. Total must sit strictly above live or deleting would never
  // free anything.
  assertEquals(DB_TASKS_LIVE_MAX, 2000)
  assertEquals(DB_HABITS_LIVE_MAX, 200)
  assert(DB_TASKS_TOTAL_MAX > DB_TASKS_LIVE_MAX)
  assert(DB_HABITS_TOTAL_MAX > DB_HABITS_LIVE_MAX)
  assertEquals(DB_HISTORY_MAX, 10000)
})

Deno.test('reminder caps: per-task tier under the per-user pool', () => {
  // unique(task_id, offset_minutes) alone admits up to 40321 rows per task; 8 is the real bound.
  // The per-user pool must exceed it (one maxed task can't be the whole allowance) while staying
  // far below the theoretical live-tasks × per-task product — the pool is the binding cap.
  assertEquals(DB_REMINDERS_PER_TASK_MAX, 8)
  assertEquals(DB_REMINDERS_PER_USER_MAX, 2000)
  assert(DB_REMINDERS_PER_TASK_MAX < DB_REMINDERS_PER_USER_MAX)
  assert(DB_REMINDERS_PER_USER_MAX < DB_TASKS_LIVE_MAX * DB_REMINDERS_PER_TASK_MAX)
})

Deno.test(
  'backups: trigger cap clears create_backup insert-then-prune, data cap fits a full snapshot',
  () => {
    // create_backup inserts the new snapshot FIRST and then prunes to its keep-10 — the trigger cap
    // must sit above 10 + 1 or the legit flow would raise at the keep limit.
    assert(DB_BACKUPS_MAX > 10 + 1)
    // A snapshot of an account at the live caps (2000 tasks × ~2 KB text + habits + schedule) stays
    // under the data bound — the cap should only ever bite a directly-INSERTed blob.
    assert(DB_BACKUP_DATA_MAX_BYTES >= 4 * 1024 * 1024)
  },
)

Deno.test('fetch limits sit above the prompt render caps (and cover every legit habit)', () => {
  // chat-context/list_tasks/run-plan fetch newest-first up to these bounds; the prompt renders at
  // most MAX_TASKS_SHOWN/MAX_HABITS_SHOWN. Fetching comfortably above the render caps keeps the
  // done/paused splits and id→label maps intact; staying far below the DB row caps is the point.
  assert(TASKS_FETCH_LIMIT > MAX_TASKS_SHOWN * 2)
  assert(HABITS_FETCH_LIMIT > MAX_HABITS_SHOWN)
  // Habits: the live cap is under the fetch limit, so no legit habit is ever truncated.
  assert(HABITS_FETCH_LIMIT > DB_HABITS_LIVE_MAX)
  // Reminders: enough for every reminder of every rendered task, with room.
  assert(REMINDERS_FETCH_LIMIT > MAX_TASKS_SHOWN * DB_REMINDERS_PER_TASK_MAX)
})

Deno.test('daily_state window absorbs the server-UTC vs user-local skew with margin', () => {
  // daily_state.date is user-local; the trigger compares against server current_date (UTC). The
  // two differ by at most one day, so any window ≥ 2 is safe; 14 leaves slack for clock skew.
  assertEquals(DB_DAILY_STATE_DATE_WINDOW_DAYS, 14)
  assert(DB_DAILY_STATE_DATE_WINDOW_DAYS >= 2)
})
