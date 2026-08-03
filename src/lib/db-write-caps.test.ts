// db-write-caps.test.ts — pins the write-volume caps ACROSS the two files that must agree:
// the migration SQL (the enforcement point) and supabase/functions/_shared/write-caps.ts (the
// constants the edge functions + deno tests read). tsc's composite projects forbid importing
// across the src/ ↔ supabase/functions boundary, so both sides come in as TEXT (?raw) and are
// pinned against the same literals here — editing a cap in one place without the other (or
// without touching this table) fails loudly. The deno side (write-caps.test.ts) holds the
// semantic cross-invariants.
import { describe, expect, it } from 'vitest'
import sql from '../../supabase/migrations/20260722100000_write_path_volume_caps.sql?raw'
import ts from '../../supabase/functions/_shared/write-caps.ts?raw'

const MIGRATION = 'supabase/migrations/20260722100000_write_path_volume_caps.sql'

// One row per cap: the number the migration must enforce, where it appears in the SQL, and the
// write-caps.ts constant that mirrors it.
const CAPS: { name: string; expected: number; sqlRe: RegExp }[] = [
  // -- content-size CHECKs
  {
    name: 'DB_TASK_TEXT_MAX',
    expected: 2000,
    sqlRe: /tasks_text_len check \(char_length\(text\) <= (\d+)\)/,
  },
  {
    name: 'DB_HABIT_TEXT_MAX',
    expected: 2000,
    sqlRe: /habits_text_len check \(char_length\(text\) <= (\d+)\)/,
  },
  {
    name: 'DB_HISTORY_TEXT_MAX',
    expected: 2000,
    sqlRe: /history_text_len check \(char_length\(text\) <= (\d+)\)/,
  },
  {
    name: 'DB_TASK_RECURRING_MAX_BYTES',
    expected: 8192,
    sqlRe: /pg_column_size\(recurring\) <= (\d+)/,
  },
  {
    name: 'DB_HABIT_SUBTASKS_MAX_BYTES',
    expected: 16384,
    sqlRe: /pg_column_size\(subtasks\) <= (\d+)/,
  },
  {
    name: 'DB_SCHEDULE_CONFIG_MAX_BYTES',
    expected: 32768,
    sqlRe: /pg_column_size\(config\) <= (\d+)/,
  },
  { name: 'DB_DAILY_MAP_MAX_BYTES', expected: 262144, sqlRe: /pg_column_size\(done\) <= (\d+)/ },
  { name: 'DB_DAILY_PLAN_MAX_BYTES', expected: 65536, sqlRe: /pg_column_size\(plan\) <= (\d+)/ },
  { name: 'DB_BACKUP_DATA_MAX_BYTES', expected: 4194304, sqlRe: /pg_column_size\(data\) <= (\d+)/ },
  { name: 'DB_TIMEZONE_MAX', expected: 64, sqlRe: /char_length\(timezone\) <= (\d+)/ },
  { name: 'DB_BACKUP_LABEL_MAX', expected: 200, sqlRe: /char_length\(label\) <= (\d+)/ },
  { name: 'DB_PUSH_ENDPOINT_MAX', expected: 1024, sqlRe: /char_length\(endpoint\) <= (\d+)/ },
  { name: 'DB_PUSH_KEY_MAX', expected: 512, sqlRe: /char_length\(p256dh\) <= (\d+)/ },
  // -- row-cap triggers (matched through their raise so same-number caps stay distinguishable)
  {
    name: 'DB_TASKS_LIVE_MAX',
    expected: 2000,
    sqlRe: /if v_live > (\d+) then\s+raise exception 'task_cap_reached'/,
  },
  {
    name: 'DB_TASKS_TOTAL_MAX',
    expected: 10000,
    sqlRe: /if v_total > (\d+) then\s+raise exception 'task_storage_cap_reached'/,
  },
  {
    name: 'DB_HABITS_LIVE_MAX',
    expected: 200,
    sqlRe: /if v_live > (\d+) then\s+raise exception 'habit_cap_reached'/,
  },
  {
    name: 'DB_HABITS_TOTAL_MAX',
    expected: 1000,
    sqlRe: /if v_total > (\d+) then\s+raise exception 'habit_storage_cap_reached'/,
  },
  {
    name: 'DB_HISTORY_MAX',
    expected: 10000,
    sqlRe: /public\.history where user_id = new\.user_id\) > (\d+)/,
  },
  {
    name: 'DB_REMINDERS_PER_TASK_MAX',
    expected: 8,
    sqlRe: /public\.task_reminders where task_id = new\.task_id\) > (\d+)/,
  },
  {
    name: 'DB_REMINDERS_PER_USER_MAX',
    expected: 2000,
    sqlRe: /public\.task_reminders where user_id = new\.user_id\) > (\d+)/,
  },
  {
    name: 'DB_BACKUPS_MAX',
    expected: 15,
    sqlRe: /public\.backups where user_id = new\.user_id\) > (\d+)/,
  },
  {
    name: 'DB_PUSH_SUBSCRIPTIONS_MAX',
    expected: 20,
    sqlRe: /public\.push_subscriptions where user_id = new\.user_id\) > (\d+)/,
  },
  // -- daily_state window (weather_cache is PR #310's, not pinned here)
  {
    name: 'DB_DAILY_STATE_DATE_WINDOW_DAYS',
    expected: 14,
    sqlRe: /new\.date < current_date - (\d+)/,
  },
]

describe('write-path volume caps: migration SQL and write-caps.ts agree', () => {
  it.each(CAPS)('$name = $expected in both files', ({ name, expected, sqlRe }) => {
    const m = sql.match(sqlRe)
    expect(m, `migration lost the ${name} enforcement (${sqlRe})`).not.toBeNull()
    expect(Number(m![1]), `${name} in ${MIGRATION}`).toBe(expected)
    const tsRe = new RegExp(`export const ${name} = (\\d+)`)
    const t = ts.match(tsRe)
    expect(t, `write-caps.ts lost ${name}`).not.toBeNull()
    expect(Number(t![1]), `${name} in write-caps.ts`).toBe(expected)
  })

  it('the daily_state window is symmetric (− and + sides match)', () => {
    const m = sql.match(/new\.date < current_date - (\d+) or new\.date > current_date \+ (\d+)/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(m![2])
  })

  it('the second maps constraint set reuses the shared map bound', () => {
    // done_at / habit_done / subtask_done must carry the same 256 KB bound as done.
    for (const col of ['done_at', 'habit_done', 'subtask_done']) {
      const m = sql.match(new RegExp(`pg_column_size\\(${col}\\) <= (\\d+)`))
      expect(m, `daily_state.${col} size CHECK missing`).not.toBeNull()
      expect(Number(m![1])).toBe(262144)
    }
  })

  it('task_reminders is SELECT-only: all three write grants revoked, every writer DEFINER', () => {
    // The 2026-07-06 audit item plus the sent_at=null re-fire hole: all app writes go through
    // the reminder RPCs, so the direct PostgREST INSERT/UPDATE/DELETE paths are revoked — which
    // only works because every function that writes the table (the RPCs AND the recompute
    // trigger fns) stopped running its DML as the caller (SECURITY DEFINER + explicit fences).
    expect(sql).toMatch(
      /revoke insert, update, delete on public\.task_reminders from authenticated;/,
    )
    for (const policy of [
      'task_reminders_insert_own',
      'task_reminders_update_own',
      'task_reminders_delete_own',
    ]) {
      expect(sql).toMatch(new RegExp(`drop policy if exists "${policy}"`))
    }
    for (const fn of [
      'set_task_reminder',
      'remove_task_reminder',
      'clear_task_reminder',
      'task_reminders_recompute_fn',
      'task_reminders_tz_recompute_fn',
      'task_reminders_recurring_change_fn',
    ]) {
      expect(sql, `${fn} must be re-created SECURITY DEFINER`).toMatch(
        new RegExp(
          `create or replace function public\\.${fn}\\([^)]*\\)[\\s\\S]*?security definer`,
        ),
      )
    }
    expect(sql).toMatch(/where id = p_task_id and user_id = auth\.uid\(\) and deleted_at is null/)
  })

  it('row-cap triggers are AFTER INSERT (upsert-safe: conflict-updates must not count)', () => {
    // restore_backup upserts tasks/habits and set_task_reminder re-arms via ON CONFLICT — a
    // BEFORE INSERT count would spuriously raise at the cap on those paths.
    for (const trg of [
      'tasks_cap',
      'habits_cap',
      'history_cap',
      'task_reminders_cap_ins',
      'backups_cap',
      'push_subscriptions_cap',
    ]) {
      expect(sql).toMatch(new RegExp(`create trigger ${trg}\\s+after insert`))
    }
  })
})
