-- Migration: task_completed_at
--
-- Intent: make completing a one-off (non-recurring) task PERMANENT.
--
-- The bug this fixes: a completed one-off task's "done" state lived only in TODAY's
-- daily_state.done map, which is keyed by the user's LOCAL calendar day. That map is the
-- right home for things that reset daily (habits, subtasks) — but a one-off completion is
-- NOT a daily event. At the next local midnight the daily_state key flips to a fresh (empty)
-- day, so done[id] is gone and the task reappeared on the grid/list, while its permanent
-- history row stayed — and completing it again appended a SECOND history row ("in Done twice").
--
-- The fix: a one-off task's completion becomes a permanent property of the TASK itself.
--   * tasks.completed_at (nullable timestamptz): null = live, non-null = completed one-off.
--   * set_task_done now stamps completed_at = now() in the SAME transaction as the done-map
--     merge + history insert (still atomic, still no done-without-history window).
--   * set_task_undone (Restore) clears completed_at, returning the task to the grid.
-- The grid/list/mobile surfaces hide any task with completed_at set, independent of which
-- local day it was completed on — so a completion can never be resurrected by a day rollover.
--
-- Recurring tasks are unaffected: they are never marked via set_task_done (they reset their
-- own recurring.lastDoneAt), so completed_at stays null for them. daily_state.done / done_at
-- are still written for continuity (harmless) but no longer the load-bearing hide for one-off
-- tasks. Existing rows get completed_at = NULL (no backfill: "has a history row" does not imply
-- "should be hidden" — a task may have been intentionally restored/kept active).
--
-- Down path (manual reversal):
--   -- restore the pre-change function bodies from 20260624000000_history_and_daily_state_rpc.sql
--   -- (drop the two `tasks` UPDATE statements added below), then:
--   alter table public.tasks drop column if exists completed_at;

-- ============================================================================
-- (a) permanent one-off completion marker on the task
-- ============================================================================

alter table public.tasks
  add column completed_at timestamptz;   -- null = live; non-null = completed one-off task

comment on column public.tasks.completed_at is
  'When a one-off (non-recurring) task was completed. null = live. Permanent (survives the '
  'daily reset, unlike daily_state.done) so a completion is never resurrected at local '
  'midnight. Cleared by Restore (set_task_undone). Recurring tasks never set this.';

-- ============================================================================
-- (b) set_task_done — additionally stamp tasks.completed_at (same transaction)
-- ============================================================================

create or replace function public.set_task_done(
  p_date    date,
  p_task_id uuid,
  p_text    text,
  p_bucket  text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set done    = done    || jsonb_build_object(p_task_id::text, true),
      done_at = done_at || jsonb_build_object(p_task_id::text, to_jsonb(now()::text))
  where user_id = auth.uid()
    and date = p_date;

  -- Permanent completion marker on the task itself (the load-bearing hide across days).
  -- Owner-scoped; RLS (tasks_update_own) lets a caller only touch their own task.
  update public.tasks
  set completed_at = now()
  where id = p_task_id
    and user_id = auth.uid();

  insert into public.history (task_id, text, bucket)
  values (p_task_id, p_text, p_bucket);
end;
$$;

-- ============================================================================
-- (c) set_task_undone (Restore) — clear tasks.completed_at so it returns to the grid
-- ============================================================================

create or replace function public.set_task_undone(
  p_date    date,
  p_task_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set done    = done    || jsonb_build_object(p_task_id::text, false),
      done_at = done_at - p_task_id::text
  where user_id = auth.uid()
    and date = p_date;

  -- Un-complete the task so it returns to the grid at its stored x/y.
  update public.tasks
  set completed_at = null
  where id = p_task_id
    and user_id = auth.uid();
end;
$$;
