-- Migration: create_daily_state
--
-- Intent: per-day completion state — what the user checked off on a given day. Replaces
-- EisenClaw's single mutable {done, doneAt, habitDone, subtaskDone} blob
-- (planning/EISENCLAW-LOGIC-TO-PORT.md §9-10) with one row per (user, local-calendar-day).
--
-- WHY one row per day (not a single current-state row):
--   The original "reset" DESTRUCTIVELY cleared the maps on load when lastReset != today
--   (§10), which races the debounced save and can eat state. Here each day is its own row,
--   so the daily reset is non-destructive by construction: "today" is just the row for
--   today's date; yesterday's row persists untouched. There is deliberately NO `lastReset`
--   column — the existence of today's row IS the reset signal, so the stale-comparison bug
--   the original had cannot recur.
--
-- WHY `date` is the USER's local calendar date (not server-UTC):
--   The original mixed UTC (reset comparison) with local midnight (daysUntil), a real bug
--   (§ Discrepancies #3). `date` MUST be the calendar date in the user's stored timezone
--   (user_schedule.timezone). The app computes it with src/lib/dates.ts `localDateInTZ(tz)`
--   and passes it in. Never default this to `current_date` — in Supabase that is server-UTC
--   and would reintroduce the bug. No DB default is set on `date` on purpose, to force the
--   caller to supply the timezone-correct value.
--
-- Map shapes (all jsonb objects, default '{}'):
--   done        { "<taskId>":  true }            -- task marked done today
--   done_at     { "<taskId>":  "<ISO instant>" } -- when (full timestamptz string; for
--                                                    ordering / restore — NOT a date)
--   habit_done  { "<habitId>": true }
--   subtask_done{ "<habitId>:<subtaskId>": true} -- COMPOSITE string key "habitId:subtaskId"
--
-- The permanent completion history (Done tab, denormalized log with restore) is a SEPARATE,
-- additive concern deferred to Stage 3 — it is intentionally not modeled here.
--
-- Security model — same owner-scoped RLS as public.tasks. No soft-delete (per-day rows are
-- the historical record; they are never deleted by the app) and no DELETE grant/policy.
--
-- Down path (manual reversal):
--   drop table if exists public.daily_state;

create table public.daily_state (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date         date not null,                       -- user-local calendar day (see header)
  done         jsonb not null default '{}'::jsonb,
  done_at      jsonb not null default '{}'::jsonb,
  habit_done   jsonb not null default '{}'::jsonb,
  subtask_done jsonb not null default '{}'::jsonb,  -- composite key "habitId:subtaskId"
  primary key (user_id, date)
);

comment on table public.daily_state is
  'Per-day completion state, one row per (user_id, local-calendar date). date is the user''s '
  'local day (user_schedule.timezone), never server-UTC. The daily reset is non-destructive: '
  'today = the row for today''s date. No hard-delete; permanent history is a Stage 3 table.';

alter table public.daily_state enable row level security;

-- RLS on top of grants; both required. No DELETE (rows are the historical record).
grant select, insert, update on public.daily_state to authenticated;

create policy "daily_state_select_own"
  on public.daily_state for select
  to authenticated
  using (user_id = auth.uid());

create policy "daily_state_insert_own"
  on public.daily_state for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "daily_state_update_own"
  on public.daily_state for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
