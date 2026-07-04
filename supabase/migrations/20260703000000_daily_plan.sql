-- Migration: daily_plan
--
-- Intent: persist the "Plan My Day" result so it survives a page reload and auto-clears at
-- the user's local midnight — with ZERO cleanup job. EisenClaw's plan was in-memory only
-- (planning/eisenclaw-export/scripts/planner.html ~L680-717) and vanished on refresh; the
-- redesign shows it in a PERSISTENT inline card above the grid that stays for the whole day.
--
-- WHY hang it on the existing per-(user_id, date) daily_state row (not a new table):
--   daily_state is already keyed by the user's LOCAL calendar day (never server-UTC — see
--   *_create_daily_state.sql). Storing today's plan on today's row means the midnight-clear is
--   non-destructive BY CONSTRUCTION: crossing local midnight reads a DIFFERENT date's row,
--   which has no plan yet, so yesterday's plan is simply not read (and is never mutated). No
--   TTL, no cron, no lastReset comparison. `plan` is nullable = "not planned today".
--
-- Shape: `plan` is the DayPlan the plan-my-day Edge Function emits, stored verbatim as jsonb —
--   { headline, availableTime, bigRock: Rock|null, smallRocks: Rock[], habitNote }, where
--   Rock = { task, why, duration, when }. Validated client-side at the read boundary
--   (src/types/plan.ts DayPlanSchema); the DB treats it as opaque jsonb.
--
-- Write path: the plan-my-day Edge Function stays STATELESS (it only calls Anthropic); the
--   client persists the result via save_daily_plan() below after the function succeeds. This
--   keeps the AI call and the storage concern separate and mirrors how the client already
--   writes daily_state (set_daily_flag / set_task_done).
--
-- Security: same owner-scoped RLS as the rest of daily_state (already enabled). save_daily_plan
--   is SECURITY INVOKER — it runs as the caller, so RLS applies and user_id is ALWAYS auth.uid()
--   (never a parameter); a caller cannot write another user's row. Mirrors set_daily_flag.
--
-- Down path (manual reversal):
--   drop function if exists public.save_daily_plan(date, jsonb);
--   alter table public.daily_state drop column if exists plan;

alter table public.daily_state add column plan jsonb;  -- nullable = not planned today

comment on column public.daily_state.plan is
  'Today''s Plan My Day result (DayPlan jsonb), or NULL if not planned today. Auto-clears at '
  'local midnight because a new day reads a different (user_id, date) row. Written by '
  'save_daily_plan(); opaque jsonb here, validated client-side (src/types/plan.ts).';

-- Persist today's plan onto the user's local-day row, atomically. Ensures the row exists
-- (insert ... on conflict do nothing) then writes plan. p_date is the USER's LOCAL calendar
-- day (computed client-side with src/lib/dates.ts localDateInTZ(tz)), mirroring daily_state.date
-- and the other daily_state RPCs — never server-UTC. SECURITY INVOKER: user_id is auth.uid(),
-- never a parameter, so RLS scopes the write to the caller.
create or replace function public.save_daily_plan(
  p_date date,
  p_plan jsonb
)
returns void
language plpgsql
security invoker
-- Lock search_path so the function resolves public objects regardless of caller session
-- settings (defense-in-depth even under INVOKER), matching the other daily_state RPCs.
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set plan = p_plan
  where user_id = auth.uid()
    and date = p_date;
end;
$$;

grant execute on function public.save_daily_plan(date, jsonb) to authenticated;
