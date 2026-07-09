-- Migration: task_reminders pipeline (ADR 2026-07-09-task-reminders-pg-cron-push)
--
-- Intent: per-task push reminders ("buzz me 1 hour before this is due") for tasks with a due
-- TIME. Four pieces, all in-database except the sender:
--
--   • task_reminders — one pending reminder per task (v1; drop the unique to allow several).
--     fire_at is the MATERIALIZED instant: (due + due_time) interpreted in the user's timezone
--     minus the offset. Wall-clock doctrine: the instant is derived, never authored, so two
--     triggers keep it honest — a due/due_time edit recomputes AND re-arms (the old send was for
--     the old deadline); a timezone change recomputes pending fire times only (same deadline,
--     new clock — the choke point the settings save / mismatch banner write through).
--   • DEFINER RPCs (service_role only, same fencing as dispatch_rpcs.sql): the minute sweep
--     reads due_task_reminders (fresh-only: ≤60 min late), claims each row exactly-once
--     (claim_task_reminder — the UPDATE is the send lock), expires anything older than the
--     freshness window unsent (a reminder an hour late is noise, not help), and records the
--     inbox row via insert_reminder_message.
--   • messages grows kind='reminder'. The (user_id, local_date, kind) uniqueness becomes a
--     PARTIAL index over the daily kinds only — reminders are per-task, several a day is
--     correct — and claim_message's ON CONFLICT gains the matching predicate.
--   • pg_cron + pg_net (the upgrade path ADR-0031 reserved): a '* * * * *' job POSTs to the
--     dispatch-reminders Edge Function with the shared secret. URL + secret live in Vault
--     (names: dispatch_reminders_url, dispatch_secret) — the job no-ops until the owner sets
--     them, so local stacks and pre-setup prod stay quiet. Digests keep their hourly GitHub
--     Actions cron (notify.yml) unchanged.
--
-- Access model: clients CRUD their own reminder rows under RLS (the PR-5 editors write them);
-- the system touches them only through the DEFINER RPCs; triggers run as the editing user
-- against their own rows.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   select cron.unschedule('dispatch-reminders');
--   drop trigger if exists task_reminders_recompute on public.tasks;
--   drop trigger if exists task_reminders_tz_recompute on public.user_schedule;
--   drop function if exists public.task_reminders_recompute_fn();
--   drop function if exists public.task_reminders_tz_recompute_fn();
--   drop function if exists public.due_task_reminders();
--   drop function if exists public.claim_task_reminder(uuid);
--   drop function if exists public.expire_stale_reminders();
--   drop function if exists public.insert_reminder_message(uuid, date, text, text, jsonb);
--   drop table if exists public.task_reminders;
--   -- messages: restore the strict kind check + full unique constraint, then re-create
--   -- claim_message from 20260707130000_messages.sql
-- ----------------------------------------------------------------------------

-- ============================================================================
-- task_reminders
-- ============================================================================

create table public.task_reminders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id        uuid not null references public.tasks (id) on delete cascade,
  -- Minutes before the due instant (0 = at the due time). Bounded to 28 days.
  offset_minutes int  not null check (offset_minutes >= 0 and offset_minutes <= 40320),
  -- The materialized instant this reminder fires: dueInstant(due, due_time, tz) − offset.
  fire_at        timestamptz not null,
  -- Send lock + history: null = pending; set by claim_task_reminder / expire_stale_reminders.
  sent_at        timestamptz,
  created_at     timestamptz not null default now(),
  -- v1: one reminder per task (the editors upsert on task_id and reset sent_at to re-arm).
  unique (task_id)
);

comment on table public.task_reminders is
  'Per-task push reminders (ADR 2026-07-09): fire_at = (due + due_time in the user''s timezone) − '
  'offset_minutes, materialized on write and kept honest by the due/timezone triggers. The minute '
  'cron sweeps pending rows; claim_task_reminder is the exactly-once send lock.';

-- The sweep's scan: pending rows in fire order.
create index task_reminders_pending_idx on public.task_reminders (fire_at) where sent_at is null;

alter table public.task_reminders enable row level security;

grant select, insert, update, delete on public.task_reminders to authenticated;

create policy "task_reminders_select_own"
  on public.task_reminders for select
  to authenticated
  using (user_id = auth.uid());

create policy "task_reminders_insert_own"
  on public.task_reminders for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "task_reminders_update_own"
  on public.task_reminders for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "task_reminders_delete_own"
  on public.task_reminders for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- Triggers — fire_at can never go stale
-- ============================================================================

-- A due/due_time edit recomputes fire_at in the OWNER's timezone and RE-ARMS (sent_at := null):
-- a reminder that already fired was for the old deadline. Clearing the date or the time deletes
-- the reminder — an alarm without an instant is meaningless.
create or replace function public.task_reminders_recompute_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tz text;
begin
  if new.due is null or new.due_time is null then
    delete from public.task_reminders where task_id = new.id;
    return new;
  end if;

  select timezone into v_tz from public.user_schedule where user_id = new.user_id;

  update public.task_reminders
     set fire_at = ((new.due::timestamp + new.due_time) at time zone coalesce(v_tz, 'UTC'))
                   - make_interval(mins => offset_minutes),
         sent_at = null
   where task_id = new.id;

  return new;
end;
$$;

create trigger task_reminders_recompute
  after update of due, due_time on public.tasks
  for each row
  when (old.due is distinct from new.due or old.due_time is distinct from new.due_time)
  execute function public.task_reminders_recompute_fn();

-- A timezone change recomputes PENDING fire times only (same deadline, new clock) — the single
-- choke point the settings save / mismatch banner write through.
create or replace function public.task_reminders_tz_recompute_fn()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.task_reminders r
     set fire_at = ((t.due::timestamp + t.due_time) at time zone new.timezone)
                   - make_interval(mins => r.offset_minutes)
    from public.tasks t
   where r.task_id = t.id
     and r.user_id = new.user_id
     and r.sent_at is null
     and t.due is not null
     and t.due_time is not null;
  return new;
end;
$$;

create trigger task_reminders_tz_recompute
  after update of timezone on public.user_schedule
  for each row
  when (old.timezone is distinct from new.timezone)
  execute function public.task_reminders_tz_recompute_fn();

-- ============================================================================
-- messages: admit kind='reminder'; daily uniqueness becomes partial
-- ============================================================================

alter table public.messages drop constraint messages_kind_check;
alter table public.messages
  add constraint messages_kind_check check (kind in ('plan', 'recap', 'reminder'));

-- The one-per-day rule only ever applied to the daily kinds; reminders are per-task events.
alter table public.messages drop constraint messages_user_id_local_date_kind_key;
create unique index messages_daily_kind_key
  on public.messages (user_id, local_date, kind)
  where kind in ('plan', 'recap');

-- claim_message must name the partial index's predicate for ON CONFLICT to find its arbiter.
-- Body otherwise identical to 20260707130000_messages.sql.
create or replace function public.claim_message(
  p_user_id    uuid,
  p_kind       text,
  p_local_date date,
  p_title      text,
  p_body       text,
  p_data       jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.messages (user_id, kind, local_date, title, body, data)
  values (p_user_id, p_kind, p_local_date, p_title, p_body, p_data)
  on conflict (user_id, local_date, kind) where kind in ('plan', 'recap') do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ============================================================================
-- Sweep RPCs (SECURITY DEFINER, service_role only)
-- ============================================================================

-- Pending reminders ready to send: fired, FRESH (≤60 min late — an hour-late "reminder" is
-- noise; expire_stale_reminders retires older ones), task still live, not recurring, not done
-- today (in the user's own calendar day).
create or replace function public.due_task_reminders()
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
     and t.recurring is null
     and t.due is not null
     and t.due_time is not null
     and coalesce((ds.done ->> t.id::text)::boolean, false) = false
   order by r.fire_at;
$$;

-- The exactly-once send lock: first caller gets the id, an overlapping run gets null.
create or replace function public.claim_task_reminder(p_id uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  update public.task_reminders
     set sent_at = now()
   where id = p_id and sent_at is null
   returning id;
$$;

-- Retire unsent reminders older than the freshness window (cron outage, long sleep). Returns
-- how many were expired so the dispatcher can log it.
create or replace function public.expire_stale_reminders()
returns int
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.task_reminders
       set sent_at = now()
     where sent_at is null
       and fire_at <= now() - interval '60 minutes'
     returning 1
  )
  select count(*)::int from expired;
$$;

-- The inbox row for a sent reminder (kind='reminder' has no daily uniqueness — plain insert).
create or replace function public.insert_reminder_message(
  p_user_id    uuid,
  p_local_date date,
  p_title      text,
  p_body       text,
  p_data       jsonb default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.messages (user_id, kind, local_date, title, body, data)
  values (p_user_id, 'reminder', p_local_date, p_title, p_body, p_data)
  returning id;
$$;

revoke all on function public.due_task_reminders() from public;
grant execute on function public.due_task_reminders() to service_role;
revoke all on function public.claim_task_reminder(uuid) from public;
grant execute on function public.claim_task_reminder(uuid) to service_role;
revoke all on function public.expire_stale_reminders() from public;
grant execute on function public.expire_stale_reminders() to service_role;
revoke all on function public.insert_reminder_message(uuid, date, text, text, jsonb) from public;
grant execute on function public.insert_reminder_message(uuid, date, text, text, jsonb) to service_role;

-- ============================================================================
-- The minute hand: pg_cron + pg_net → dispatch-reminders
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every minute, POST to the dispatch-reminders Edge Function with the shared secret — but ONLY
-- once the owner has set both Vault secrets (one-time setup, SQL editor):
--   select vault.create_secret('<https://…/functions/v1/dispatch-reminders>', 'dispatch_reminders_url');
--   select vault.create_secret('<same value as the DISPATCH_SECRET function env>', 'dispatch_secret');
-- Until then the WHERE clause makes the job a no-op (local stacks, fresh environments).
-- cron.schedule upserts by job name, so re-running this migration is safe.
select cron.schedule(
  'dispatch-reminders',
  '* * * * *',
  $$
  select net.http_post(
           url     := s.url,
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'x-dispatch-secret', s.secret
                      ),
           body    := '{}'::jsonb
         )
    from (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_reminders_url') as url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')        as secret
    ) s
   where s.url is not null and s.secret is not null
  $$
);
