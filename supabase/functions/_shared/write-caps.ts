// write-caps.ts — per-user write-volume caps + edge-function fetch bounds, in an import-free
// module (the guardrails-constants.ts pattern) so tests and every reader can import it without
// cycles. RLS confines a user to their OWN rows; these caps bound HOW MUCH they can write there
// (the "million tasks via curl" class) — on the shared free-tier database, storage exhaustion is
// a whole-app outage, so boundedness is an availability guard, not a UX quota.
//
// The DB_* values MIRROR the SQL in 20260722100000_write_path_volume_caps.sql — the database is
// the enforcement point; these constants exist so tests can pin both sides against the same
// numbers (write-caps.test.ts here, src/lib/db-write-caps.test.ts over the migration text).

// ---- content-size caps (CHECK constraints) --------------------------------------------------
// Text caps match BabyClaw's create_task/update_task zod bound (.max(2000) in
// capabilities/tasks.ts) so the DB never rejects what a capability accepted.
export const DB_TASK_TEXT_MAX = 2000
export const DB_BUCKET_MAX = 100 // tasks.bucket / history.bucket (quadrant labels are short)
export const DB_TASK_RECURRING_MAX_BYTES = 8192 // legit shape is ~200 B
export const DB_HABIT_TEXT_MAX = 2000
export const DB_HABIT_SUBTASKS_MAX_BYTES = 16384 // ~dozens of {id,text} steps ≈ 2 KB
export const DB_HISTORY_TEXT_MAX = 2000 // snapshot of task text at completion
export const DB_TIMEZONE_MAX = 64 // IANA names top out around 32 chars
export const DB_SCHEDULE_CONFIG_MAX_BYTES = 32768 // real configs are ~2 KB
export const DB_DAILY_MAP_MAX_BYTES = 262144 // done/done_at/habit_done/subtask_done, each
export const DB_DAILY_PLAN_MAX_BYTES = 65536 // model output is a few KB
export const DB_BACKUP_LABEL_MAX = 200
export const DB_BACKUP_DATA_MAX_BYTES = 4194304 // 4 MB ≫ a full legit snapshot
export const DB_PUSH_ENDPOINT_MAX = 1024 // push-service URLs run ~150–300 chars
export const DB_PUSH_KEY_MAX = 512 // p256dh ≈ 87 chars, auth ≈ 22 chars (base64url)
// weather_cache is bounded by PR #310 instead (RPCs become service_role-only) — see the migration
// header for why this file leaves it alone.

// ---- per-user row caps (AFTER INSERT triggers) ----------------------------------------------
// Two tiers where rows soft-delete (tasks/habits): the LIVE cap is the user-meaningful bound
// (freeable by deleting), the TOTAL cap bounds storage against create→delete churn.
export const DB_TASKS_LIVE_MAX = 2000
export const DB_TASKS_TOTAL_MAX = 10000
export const DB_HABITS_LIVE_MAX = 200
export const DB_HABITS_TOTAL_MAX = 1000
export const DB_HISTORY_MAX = 10000 // hard rows; the Done tab's × frees space
export const DB_REMINDERS_PER_TASK_MAX = 8
export const DB_REMINDERS_PER_USER_MAX = 2000
export const DB_BACKUPS_MAX = 15 // > create_backup's keep-10 + its pre-prune insert
export const DB_PUSH_SUBSCRIPTIONS_MAX = 20 // one per browser/device is the real shape
// daily_state has no row cap: inserts are bounded to ±window days of the server day, so rows can
// only accrue at ~one per real day.
export const DB_DAILY_STATE_DATE_WINDOW_DAYS = 14

// ---- edge-function fetch bounds -------------------------------------------------------------
// Reads that feed prompts render at most MAX_TASKS_SHOWN/MAX_HABITS_SHOWN (chat-prompt.ts), but
// fetched rows also drive done/paused splits and id→label maps — so fetch comfortably above the
// render caps, newest first, and no further. Bounds function memory + model tokens even for an
// account sitting at the DB row caps.
export const TASKS_FETCH_LIMIT = 500
export const HABITS_FETCH_LIMIT = 250 // > DB_HABITS_LIVE_MAX: every legit habit still fetched
export const REMINDERS_FETCH_LIMIT = 1000
