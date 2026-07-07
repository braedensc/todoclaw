-- Migration: dispatch_rpcs
--
-- Intent: the service_role DEFINER read/prune RPCs the proactive dispatcher (dispatch-messages,
-- ADR-0031) needs. service_role bypasses RLS but has NO table DML grants (by design — see
-- 20260707120000_push_subscriptions), so every cross-user read/write the cron makes goes through a
-- DEFINER function fenced to service_role, exactly like the ADR-0030 invite RPCs. Four functions:
--
--   • notification_candidates()          — the users worth waking up: notifications enabled AND at
--                                          least one push subscription. Returns their timezone + the
--                                          notifications config so the dispatcher can do the local-hour
--                                          + quiet-hours math in TS (Intl) and decide who is due.
--   • dispatch_inputs_for_user(uid,date) — one user's plan/recap inputs (schedule config, active
--                                          tasks + habits, today's done maps) as a single jsonb bundle.
--   • push_subscriptions_for_user(uid)   — that user's push endpoints (to send to).
--   • prune_push_subscription(endpoint)  — delete an endpoint the push service reported gone (404/410).
--
-- All are execute-granted to service_role ONLY (revoked from public), so the (public) anon key can
-- never call them; only the dispatcher's admin client can.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.prune_push_subscription(text);
--   drop function if exists public.push_subscriptions_for_user(uuid);
--   drop function if exists public.dispatch_inputs_for_user(uuid, date);
--   drop function if exists public.notification_candidates();
-- ----------------------------------------------------------------------------

-- Candidate users for a dispatch run. `enabled` is read from the notifications jsonb block the client
-- writes into user_schedule.config (absent/false ⇒ excluded); a user with zero subscriptions is
-- pointless to wake, so they are excluded too. The TS side matches timezone+hour against the prefs.
create or replace function public.notification_candidates()
returns table (user_id uuid, timezone text, notifications jsonb)
language sql
security definer
set search_path = public
as $$
  select us.user_id, us.timezone, us.config -> 'notifications'
  from public.user_schedule us
  where coalesce((us.config -> 'notifications' ->> 'enabled')::boolean, false) = true
    and exists (
      select 1 from public.push_subscriptions ps where ps.user_id = us.user_id
    );
$$;

-- One user's inputs for building a plan or recap. Mirrors the SELECTs plan-my-day/run-plan do under
-- the caller's JWT, but keyed on p_user_id and returned as a single jsonb bundle (the dispatcher has
-- no direct table access). Tasks/habits carry the fields buildPlanRequest + buildRecap need; done maps
-- come from today's daily_state row (empty objects if it doesn't exist yet).
create or replace function public.dispatch_inputs_for_user(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config     jsonb;
  v_tasks      jsonb;
  v_habits     jsonb;
  v_done       jsonb;
  v_habit_done jsonb;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;

  select config into v_config from public.user_schedule where user_id = p_user_id;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'x', t.x, 'y', t.y,
             'due', t.due, 'staged', t.staged, 'recurring', t.recurring
           )),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id and t.deleted_at is null;

  select coalesce(
           jsonb_agg(jsonb_build_object('id', h.id, 'text', h.text, 'active', h.active)),
           '[]'::jsonb
         )
    into v_habits
    from public.habits h
    where h.user_id = p_user_id and h.deleted_at is null;

  select done, habit_done into v_done, v_habit_done
    from public.daily_state
    where user_id = p_user_id and date = p_local_date;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'tasks', v_tasks,
    'habits', v_habits,
    'done', coalesce(v_done, '{}'::jsonb),
    'habit_done', coalesce(v_habit_done, '{}'::jsonb)
  );
end;
$$;

-- A user's push endpoints (delivery targets).
create or replace function public.push_subscriptions_for_user(p_user_id uuid)
returns table (endpoint text, p256dh text, auth text)
language sql
security definer
set search_path = public
as $$
  select endpoint, p256dh, auth
  from public.push_subscriptions
  where user_id = p_user_id;
$$;

-- Remove a subscription the push service reported gone (HTTP 404/410). Idempotent.
create or replace function public.prune_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

-- Fence: service_role ONLY.
revoke all on function public.notification_candidates() from public;
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
revoke all on function public.push_subscriptions_for_user(uuid) from public;
revoke all on function public.prune_push_subscription(text) from public;

grant execute on function public.notification_candidates() to service_role;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;
grant execute on function public.push_subscriptions_for_user(uuid) to service_role;
grant execute on function public.prune_push_subscription(text) to service_role;
