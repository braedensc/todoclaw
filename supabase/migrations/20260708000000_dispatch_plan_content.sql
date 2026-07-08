-- Migration: dispatch_plan_content
--
-- Intent: let the proactive dispatcher (ADR-0031) put the ACTUAL morning plan into the notification
-- body — EisenClaw-Telegram style (headline, big rock, quick wins, habits) — and build the evening
-- check-in from that morning's plan items. Two changes:
--
--   • dispatch_inputs_for_user gains `plan` (today's daily_state.plan jsonb, null when not planned):
--     the morning builder formats it directly when it already exists, and the evening check-in lists
--     its unfinished items ("which of these did you knock out?").
--   • enrich_message(p_id, p_title, p_body) — the message-body upgrade RPC the messages migration
--     (20260707130000) reserved: the dispatcher claims the row FIRST with deterministic content (the
--     insert stays the atomic idempotency lock, no AI spend unless the claim wins), then generates
--     the plan and upgrades title/body before pushing. service_role-only, like the other dispatch RPCs.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.enrich_message(uuid, text, text);
--   -- restore the previous dispatch_inputs_for_user body from 20260707150000_dispatch_rpcs.sql
-- ----------------------------------------------------------------------------

-- One user's inputs for building a plan or recap — now including today's plan (null if none).
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
  v_plan       jsonb;
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

  select done, habit_done, plan into v_done, v_habit_done, v_plan
    from public.daily_state
    where user_id = p_user_id and date = p_local_date;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'tasks', v_tasks,
    'habits', v_habits,
    'done', coalesce(v_done, '{}'::jsonb),
    'habit_done', coalesce(v_habit_done, '{}'::jsonb),
    'plan', v_plan
  );
end;
$$;

-- Upgrade a claimed message's content in place (deterministic → plan-rich). The row id is the proof
-- of a won claim, so this can never create a message or touch another (user, day, kind)'s row.
create or replace function public.enrich_message(p_id uuid, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages set title = p_title, body = p_body where id = p_id;
$$;

-- Fence: service_role ONLY (dispatch_inputs_for_user's existing grant carries over the replace;
-- restated here so this file stands alone).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
revoke all on function public.enrich_message(uuid, text, text) from public;

grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;
grant execute on function public.enrich_message(uuid, text, text) to service_role;
