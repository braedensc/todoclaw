-- Migration: write-path volume caps (non-AI write-path hardening)
--
-- Intent: RLS confines every user to their OWN rows, but nothing bounded HOW MUCH they could
-- write there — a signed-in user with curl could insert a million tasks (or one gigantic jsonb)
-- and exhaust the shared free-tier database: storage exhaustion here is a whole-app outage, not
-- a per-account problem. This migration bounds the whole non-AI write surface the way
-- chat_sessions/chat_messages (20260713050000) and assistant_memories (20260713030000) already
-- are: per-row size CHECKs + per-user row-cap triggers, sized ORDERS OF MAGNITUDE above legit
-- use so they only ever bite abuse.
--
-- Design decisions:
--   • Row caps are AFTER INSERT triggers with `count > cap` (not the BEFORE/`>=` of the earlier
--     cap triggers). AFTER INSERT fires only for rows ACTUALLY inserted, so every legit
--     ON CONFLICT DO UPDATE path — restore_backup's task/habit upserts, set_task_reminder's
--     re-arm, the push-subscription refresh — updates freely at the cap, where a BEFORE INSERT
--     count would spuriously raise (BEFORE fires before conflict resolution). AFTER-ROW triggers
--     queue until the statement completes, so a bulk over-cap INSERT fails on its first check
--     and rolls back atomically. The tiny concurrent-insert race (two inserts at cap-1) is
--     acceptable, as in the existing cap triggers: this bounds storage, not billing.
--   • tasks/habits get TWO tiers: a LIVE cap (deleted_at is null — the user-meaningful bound,
--     freeable by deleting) and a higher TOTAL cap (bounds storage against create→soft-delete
--     churn, which a live-only cap can't see). history hard-deletes (20260705000000), so one cap.
--   • daily_state gets a DATE WINDOW (±14 days of the server day) instead of a row cap: rows are
--     keyed one-per-(user, local day), so bounding the writable dates bounds growth to ~one row
--     per real day with no cap that long-term legit use could ever hit. current_date is server-UTC
--     and daily_state.date is user-local, but they never differ by more than a day — the window
--     absorbs that. Enforced on INSERT and on UPDATE that MOVES date (re-keying a row out of the
--     window would mint room for endless new rows).
--   • Text CHECKs are added VALID after clamping any over-cap legacy value in place (left(),
--     which touches nothing when — as expected — no such rows exist). Without the clamp, one
--     pre-existing oversized row would make every later UPDATE of that row fail (a CHECK
--     re-validates the whole new row), bricking even soft-delete for it. jsonb size CHECKs are
--     NOT VALID instead: there is no lossless clamp for jsonb, the bounds have ~100× headroom
--     over legit shapes, and NOT VALID guarantees this migration cannot fail on legacy data
--     (the 20260709 wedged-deploy lesson). They still enforce on every new write.
--   • restore_backup is deliberately UNTOUCHED. Its task/habit upserts hit rows that already
--     exist (nothing hard-deletes tasks/habits, so every snapshot id is still present) → the
--     AFTER INSERT caps don't fire; its writes re-validate against the size CHECKs, whose
--     bounds exceed anything a legit snapshot can contain. A snapshot holding abuse-sized
--     content fails the restore ATOMICALLY (plpgsql aborts the transaction — no partial state),
--     which is the correct outcome for restoring abuse.
--   • task_reminders: the 2026-07-06 audit flagged the direct INSERT grant as unused — every app
--     write goes through set_task_reminder / remove_task_reminder / clear_task_reminder (verified
--     again by grep: the only direct .from('task_reminders') calls are SELECTs). But the grant
--     was load-bearing anyway: set_task_reminder was SECURITY INVOKER, so its INSERT ran with the
--     caller's table privileges. It becomes SECURITY DEFINER here with explicit auth.uid()
--     fencing (the ownership checks RLS used to provide), and the direct INSERT grant + policy
--     are then revoked/dropped for real. UPDATE/DELETE grants stay: the INVOKER recompute
--     triggers (due/tz/recurring edits) and remove/clear RPCs still run as the caller.
--   • weather_cache_put (DEFINER, the table's only write path) gains bounds in-function: key and
--     payload length caps plus a global row cap with stale-first eviction, so a curl loop can't
--     fill the shared cache with junk keys forever.
--
-- Error names (all errcode P0001, the existing cap-trigger convention): task_cap_reached,
-- task_storage_cap_reached, habit_cap_reached, habit_storage_cap_reached, history_cap_reached,
-- reminder_per_task_cap_reached, reminder_cap_reached, backup_cap_reached,
-- push_subscription_cap_reached, daily_state_date_out_of_range, weather_cache_full.
--
-- Owner follow-up (SQL editor, optional): confirm no legacy jsonb exceeds the NOT VALID bounds,
-- then promote them — a validated constraint documents that ALL rows comply:
--   select count(*) from public.tasks where recurring is not null and pg_column_size(recurring) > 8192;
--   select count(*) from public.habits where pg_column_size(subtasks) > 16384;
--   select count(*) from public.user_schedule where pg_column_size(config) > 32768;
--   select count(*) from public.daily_state where pg_column_size(done) > 262144
--     or pg_column_size(done_at) > 262144 or pg_column_size(habit_done) > 262144
--     or pg_column_size(subtask_done) > 262144 or pg_column_size(plan) > 65536;
--   select count(*) from public.backups where pg_column_size(data) > 4194304;
--   -- if every count is 0:
--   alter table public.tasks validate constraint tasks_recurring_size;
--   alter table public.habits validate constraint habits_subtasks_size;
--   alter table public.user_schedule validate constraint user_schedule_config_size;
--   alter table public.daily_state validate constraint daily_state_done_size;
--   alter table public.daily_state validate constraint daily_state_done_at_size;
--   alter table public.daily_state validate constraint daily_state_habit_done_size;
--   alter table public.daily_state validate constraint daily_state_subtask_done_size;
--   alter table public.daily_state validate constraint daily_state_plan_size;
--   alter table public.backups validate constraint backups_data_size;
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop index if exists public.tasks_user_all_idx;
--   drop index if exists public.habits_user_all_idx;
--   drop index if exists public.task_reminders_user_idx;
--   drop trigger if exists tasks_cap on public.tasks;
--   drop function if exists public.tasks_cap_check();
--   drop trigger if exists habits_cap on public.habits;
--   drop function if exists public.habits_cap_check();
--   drop trigger if exists history_cap on public.history;
--   drop function if exists public.history_cap_check();
--   drop trigger if exists task_reminders_cap_ins on public.task_reminders;
--   drop trigger if exists task_reminders_cap_move on public.task_reminders;
--   drop function if exists public.task_reminders_cap_check();
--   drop trigger if exists backups_cap on public.backups;
--   drop function if exists public.backups_cap_check();
--   drop trigger if exists push_subscriptions_cap on public.push_subscriptions;
--   drop function if exists public.push_subscriptions_cap_check();
--   drop trigger if exists daily_state_date_ins on public.daily_state;
--   drop trigger if exists daily_state_date_move on public.daily_state;
--   drop function if exists public.daily_state_date_check();
--   alter table public.tasks drop constraint if exists tasks_text_len,
--     drop constraint if exists tasks_bucket_len, drop constraint if exists tasks_recurring_size;
--   alter table public.habits drop constraint if exists habits_text_len,
--     drop constraint if exists habits_subtasks_size;
--   alter table public.history drop constraint if exists history_text_len,
--     drop constraint if exists history_bucket_len;
--   alter table public.user_schedule drop constraint if exists user_schedule_timezone_len,
--     drop constraint if exists user_schedule_config_size;
--   alter table public.daily_state drop constraint if exists daily_state_done_size,
--     drop constraint if exists daily_state_done_at_size,
--     drop constraint if exists daily_state_habit_done_size,
--     drop constraint if exists daily_state_subtask_done_size,
--     drop constraint if exists daily_state_plan_size;
--   alter table public.backups drop constraint if exists backups_label_len,
--     drop constraint if exists backups_data_size;
--   alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_len,
--     drop constraint if exists push_subscriptions_p256dh_len,
--     drop constraint if exists push_subscriptions_auth_len;
--   -- re-create weather_cache_put from 20260624020000_weather_cache.sql
--   -- re-create set_task_reminder (INVOKER) from 20260712000000_recurring_reminders_unify.sql, then:
--   grant insert on public.task_reminders to authenticated;
--   create policy "task_reminders_insert_own" on public.task_reminders
--     for insert to authenticated with check (user_id = auth.uid());
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 1) Content-size CHECKs
-- ============================================================================

-- Clamp any over-cap legacy text in place first, so the text CHECKs can be added VALID and no
-- pre-existing row is left permanently failing its own future UPDATEs. Expected to touch 0 rows.
update public.tasks set text = left(text, 2000) where char_length(text) > 2000;
update public.tasks set bucket = left(bucket, 100) where char_length(bucket) > 100;
update public.habits set text = left(text, 2000) where char_length(text) > 2000;
update public.history set text = left(text, 2000) where char_length(text) > 2000;
update public.history set bucket = left(bucket, 100) where char_length(bucket) > 100;
-- A >64-char timezone is garbage, not clampable — reset to the schema's safe default.
update public.user_schedule set timezone = 'UTC' where char_length(timezone) > 64;
update public.backups set label = left(label, 200) where char_length(label) > 200;
-- An over-length endpoint/key is a fabricated subscription, not a clampable one — drop it (a real
-- browser re-registers on next visit). Expected to touch 0 rows.
delete from public.push_subscriptions
  where char_length(endpoint) > 1024 or char_length(p256dh) > 512 or char_length(auth) > 512;

-- Text caps: 2000 chars matches BabyClaw's create_task/update_task zod bound, comfortably above
-- anything the UI produces. bucket holds short quadrant labels.
alter table public.tasks
  add constraint tasks_text_len check (char_length(text) <= 2000),
  add constraint tasks_bucket_len check (bucket is null or char_length(bucket) <= 100),
  add constraint tasks_recurring_size
    check (recurring is null or pg_column_size(recurring) <= 8192) not valid;

alter table public.habits
  add constraint habits_text_len check (char_length(text) <= 2000),
  add constraint habits_subtasks_size check (pg_column_size(subtasks) <= 16384) not valid;

alter table public.history
  add constraint history_text_len check (char_length(text) <= 2000),
  add constraint history_bucket_len check (bucket is null or char_length(bucket) <= 100);

alter table public.user_schedule
  add constraint user_schedule_timezone_len check (char_length(timezone) <= 64),
  add constraint user_schedule_config_size check (pg_column_size(config) <= 32768) not valid;

-- The four per-day maps are written by merge RPCs but also carry a direct UPDATE grant; 256 KB
-- each holds thousands of entries (a full 2000-task done map is ~90 KB). plan is model-shaped
-- (a few KB) but client-persisted via save_daily_plan, so it gets its own bound.
alter table public.daily_state
  add constraint daily_state_done_size check (pg_column_size(done) <= 262144) not valid,
  add constraint daily_state_done_at_size check (pg_column_size(done_at) <= 262144) not valid,
  add constraint daily_state_habit_done_size
    check (pg_column_size(habit_done) <= 262144) not valid,
  add constraint daily_state_subtask_done_size
    check (pg_column_size(subtask_done) <= 262144) not valid,
  add constraint daily_state_plan_size
    check (plan is null or pg_column_size(plan) <= 65536) not valid;

-- backups.data ≤ 4 MB: a full snapshot of an account at every cap is well under this; a directly
-- INSERTed multi-hundred-MB blob (the real abuse) is not.
alter table public.backups
  add constraint backups_label_len check (label is null or char_length(label) <= 200),
  add constraint backups_data_size check (pg_column_size(data) <= 4194304) not valid;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_len check (char_length(endpoint) <= 1024),
  add constraint push_subscriptions_p256dh_len check (char_length(p256dh) <= 512),
  add constraint push_subscriptions_auth_len check (char_length(auth) <= 512);

-- ============================================================================
-- 2) Per-user row-cap triggers (AFTER INSERT, count > cap — see header for why AFTER)
-- ============================================================================

-- The cap counts include soft-deleted rows, which the existing partial indexes
-- (…user_id_idx where deleted_at is null) can't serve — without these, every insert's count
-- would seq-scan. task_reminders had no user_id index at all (its FK doesn't make one).
create index tasks_user_all_idx on public.tasks (user_id);
create index habits_user_all_idx on public.habits (user_id);
create index task_reminders_user_idx on public.task_reminders (user_id);

-- tasks: 2000 live / 10000 total. The count runs under the writer's own visibility: for direct
-- client inserts that is RLS-scoped to their rows (WITH CHECK pins new.user_id = auth.uid(), so
-- the count is exact); under a DEFINER writer RLS is bypassed and the user_id filter alone
-- scopes it. Same reasoning for every cap trigger below.
create function public.tasks_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_live  int;
  v_total int;
begin
  select count(*) filter (where deleted_at is null), count(*)
    into v_live, v_total
    from public.tasks
    where user_id = new.user_id;
  if v_live > 2000 then
    raise exception 'task_cap_reached' using errcode = 'P0001';
  end if;
  if v_total > 10000 then
    raise exception 'task_storage_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger tasks_cap
  after insert on public.tasks
  for each row execute function public.tasks_cap_check();

-- habits: 200 live / 1000 total.
create function public.habits_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_live  int;
  v_total int;
begin
  select count(*) filter (where deleted_at is null), count(*)
    into v_live, v_total
    from public.habits
    where user_id = new.user_id;
  if v_live > 200 then
    raise exception 'habit_cap_reached' using errcode = 'P0001';
  end if;
  if v_total > 1000 then
    raise exception 'habit_storage_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger habits_cap
  after insert on public.habits
  for each row execute function public.habits_cap_check();

-- history: 10000 completions ≈ 5+ years at heavy use; the Done tab's × (owner-scoped DELETE,
-- 20260705000000) is the self-service pressure valve. Note set_task_done folds a history insert
-- into marking done, so at the cap marking-done raises until something is pruned — that is the
-- intended hard backstop, far past any legit volume.
create function public.history_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.history where user_id = new.user_id) > 10000 then
    raise exception 'history_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger history_cap
  after insert on public.history
  for each row execute function public.history_cap_check();

-- task_reminders: ≤8 lead times per task (unique(task_id, offset_minutes) otherwise admits up to
-- 40321), ≤2000 rows per user overall. Also re-checked when an UPDATE MOVES a row to another
-- task (no app path does; curl could pile rows onto one task past the per-task cap otherwise).
-- The per-user tier only applies on INSERT — an update can't change the row count.
create function public.task_reminders_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.task_reminders where task_id = new.task_id) > 8 then
    raise exception 'reminder_per_task_cap_reached' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT'
     and (select count(*) from public.task_reminders where user_id = new.user_id) > 2000 then
    raise exception 'reminder_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger task_reminders_cap_ins
  after insert on public.task_reminders
  for each row execute function public.task_reminders_cap_check();

create trigger task_reminders_cap_move
  after update of task_id on public.task_reminders
  for each row
  when (old.task_id is distinct from new.task_id)
  execute function public.task_reminders_cap_check();

-- backups: 15 > create_backup's keep-10 plus its pre-prune insert, so the legit
-- insert-then-prune flow never sees this; only a direct-INSERT loop does.
create function public.backups_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.backups where user_id = new.user_id) > 15 then
    raise exception 'backup_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger backups_cap
  after insert on public.backups
  for each row execute function public.backups_cap_check();

-- push_subscriptions: one row per browser/device endpoint; 20 is many devices. The client's
-- refresh path upserts on endpoint (an UPDATE at the cap — unaffected, see header).
create function public.push_subscriptions_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.push_subscriptions where user_id = new.user_id) > 20 then
    raise exception 'push_subscription_cap_reached' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger push_subscriptions_cap
  after insert on public.push_subscriptions
  for each row execute function public.push_subscriptions_cap_check();

-- ============================================================================
-- 3) daily_state date window (see header — a window, not a row cap)
-- ============================================================================

create function public.daily_state_date_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.date < current_date - 14 or new.date > current_date + 14 then
    raise exception 'daily_state_date_out_of_range' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger daily_state_date_ins
  before insert on public.daily_state
  for each row execute function public.daily_state_date_check();

-- Only when date actually MOVES — editing an old day's maps in place stays legal.
create trigger daily_state_date_move
  before update of date on public.daily_state
  for each row
  when (old.date is distinct from new.date)
  execute function public.daily_state_date_check();

-- ============================================================================
-- 4) weather_cache_put — bounded (body otherwise 20260624020000)
-- ============================================================================

-- The DEFINER pair is the table's ONLY access path (no grants/policies), so in-function bounds
-- fully cover it: cap the key and payload, and cap the table at 500 locations with stale-first
-- eviction (entries are ~30-min cache lines; anything older than 2 days is dead weight), so a
-- junk-key loop can't brick the shared cache for everyone.
create or replace function public.weather_cache_put(p_location text, p_data text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_location is null or char_length(p_location) > 200 then
    raise exception 'weather_location_too_long' using errcode = 'P0001';
  end if;
  if p_data is null or char_length(p_data) > 65536 then
    raise exception 'weather_data_too_large' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.weather_cache where location = p_location) then
    if (select count(*) from public.weather_cache) >= 500 then
      delete from public.weather_cache where fetched_at < now() - interval '2 days';
    end if;
    if (select count(*) from public.weather_cache) >= 500 then
      raise exception 'weather_cache_full' using errcode = 'P0001';
    end if;
  end if;
  insert into public.weather_cache (location, data)
  values (p_location, p_data)
  on conflict (location) do update
    set data = excluded.data, fetched_at = now();
end;
$$;

revoke all on function public.weather_cache_put(text, text) from public;
grant execute on function public.weather_cache_put(text, text) to authenticated;

-- ============================================================================
-- 5) set_task_reminder → SECURITY DEFINER; revoke the direct INSERT path
-- ============================================================================

-- Body identical to 20260712000000 except: DEFINER (RLS no longer applies inside), so the task
-- lookup gains an explicit user_id = auth.uid() fence — under INVOKER that exact scoping came
-- from RLS — the insert pins user_id explicitly, and a no-JWT call is rejected up front.
-- auth.uid() still resolves to the CALLER inside a DEFINER function (it reads the request JWT),
-- so ownership semantics are unchanged. The ON CONFLICT re-arm stays safe: the conflict target
-- (task_id, offset_minutes) is reachable only through the fenced task.
create or replace function public.set_task_reminder(p_task_id uuid, p_offset_minutes int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due       date;
  v_due_time  time;
  v_recurring jsonb;
  v_freq      int;
  v_tz        text;
  v_fire      timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_offset_minutes is null or p_offset_minutes < 0 or p_offset_minutes > 40320 then
    raise exception 'offset_out_of_range' using errcode = 'P0001';
  end if;

  -- Explicit ownership fence (this ran under RLS when the function was INVOKER).
  select due, due_time, recurring into v_due, v_due_time, v_recurring
    from public.tasks
    where id = p_task_id and user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  if v_due is null or v_due_time is null then
    raise exception 'task_missing_due_time' using errcode = 'P0001';
  end if;

  select timezone into v_tz from public.user_schedule where user_id = auth.uid();
  v_tz := coalesce(v_tz, 'UTC');

  if v_recurring is not null then
    v_freq := (v_recurring ->> 'frequencyDays')::int;
    v_fire := public.next_recurring_fire_at(v_due, v_due_time, v_freq, p_offset_minutes, v_tz);
  else
    v_fire := public.reminder_fire_at(v_due, v_due_time, v_tz, p_offset_minutes);
  end if;

  insert into public.task_reminders (user_id, task_id, offset_minutes, fire_at, sent_at)
  values (auth.uid(), p_task_id, p_offset_minutes, v_fire, null)
  on conflict (task_id, offset_minutes) do update
    set fire_at = excluded.fire_at,
        sent_at = null;

  return v_fire;
end;
$$;

revoke all on function public.set_task_reminder(uuid, int) from public;
grant execute on function public.set_task_reminder(uuid, int) to authenticated;

-- With the only INSERTer now DEFINER, the direct client INSERT surface closes for real. UPDATE
-- and DELETE grants remain — the INVOKER recompute trigger functions and the remove/clear RPCs
-- run those as the caller (and RLS scopes them to own rows).
revoke insert on public.task_reminders from authenticated;
drop policy if exists "task_reminders_insert_own" on public.task_reminders;
