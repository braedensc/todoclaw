-- Migration: cap the per-run size of the reminder sweep (starvation / availability guard).
--
-- Intent: due_task_reminders() selects EVERY due reminder across ALL users with no bound, and
-- dispatch-reminders processes them serially each minute. A single user with a large backlog (many
-- tasks × many offsets) could return a run so large it never finishes inside the minute, degrading
-- reminder latency for everyone. Add a per-run LIMIT so each sweep does a bounded amount of work; the
-- ORDER BY r.fire_at (oldest first, unchanged) means the most-overdue reminders are always drained
-- first, and anything above the cap is picked up by the next minute's run (it is still within the
-- 60-minute freshness window). Paired with the per-user task_reminders cap (DB-caps work) so no
-- single account can fill the batch run after run.
--
-- Signature change only: the return shape is identical, so DROP + CREATE. New optional p_limit
-- (default 500) is clamped in-SQL to a hard ceiling of 2000 so even a mis-set caller stays bounded.
-- Grants re-issued (service_role only — the dispatcher's admin client).
--
-- The SELECT body is VERBATIM from the LATEST definition — 20260717120000_task_start_date.sql (NOT
-- the older 20260712000000) — so the DORMANT-task filter (paused tasks don't push mid-pause) is
-- preserved; only ORDER BY gains a LIMIT. Keep it based on the latest body in any future re-create.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restore the unbounded no-arg signature):
--   drop function if exists public.due_task_reminders(int);
--   -- then re-run the due_task_reminders() body from 20260717120000_task_start_date.sql
--   -- (no p_limit / LIMIT) and re-grant execute to service_role.
-- ----------------------------------------------------------------------------

drop function if exists public.due_task_reminders();

create function public.due_task_reminders(p_limit int default 500)
returns table (
  id             uuid,
  user_id        uuid,
  task_id        uuid,
  task_text      text,
  due            date,
  due_time       time,
  timezone       text,
  offset_minutes int
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.user_id, t.id, t.text, t.due, t.due_time, us.timezone, r.offset_minutes
    from public.task_reminders r
    join public.tasks t on t.id = r.task_id
    join public.user_schedule us on us.user_id = r.user_id
    left join public.daily_state ds
      on ds.user_id = r.user_id
     and ds.date = (now() at time zone us.timezone)::date
   where r.sent_at is null
     and r.fire_at <= now()
     and r.fire_at > now() - interval '60 minutes'
     and t.deleted_at is null
     and t.due is not null
     and t.due_time is not null
     -- dormant (future start date, user's local day) ⇒ no push (from 20260717120000_task_start_date)
     and (t.start_date is null or t.start_date <= (now() at time zone us.timezone)::date)
     and (
       -- recurring: fixed-cadence, fires regardless of done-today
       t.recurring is not null
       -- one-off: not already done today
       or coalesce((ds.done ->> t.id::text)::boolean, false) = false
     )
   order by r.fire_at
   -- Bound each sweep. Clamp the caller's value to [1, 2000] so a bad p_limit can't unbound the run.
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

revoke all on function public.due_task_reminders(int) from public;
grant execute on function public.due_task_reminders(int) to service_role;
