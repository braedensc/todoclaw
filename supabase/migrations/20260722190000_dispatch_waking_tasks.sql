-- Intent: surface PAUSED / not-yet-started tasks that un-pause SOON to the evening check-in as
-- gentle "coming up" heads-ups. dispatch_inputs_for_user gains a NEW `waking` jsonb key: dormant
-- tasks whose start_date lands within the look-ahead window (start_date > local today AND
-- start_date <= local today + 3 days). They are MENTIONED, never scheduled — so they stay OUT of
-- the existing `tasks` key (dormant tasks must keep being excluded there, or a paused task would
-- leak back onto the board/plan). Mirrors the Plan My Day "COMING UP" block (plan-prompt.ts
-- UPCOMING_WINDOW_DAYS = 3) on the recap side.
--
-- Re-created VERBATIM from the latest definition (20260717120000_task_start_date.sql) — every prior
-- behavior is preserved: completed_at + dormancy exclusion on `tasks`, the config/habits/daily_state
-- reads, and the service_role-only REVOKE/GRANT fence. Only the `waking` select + return key are new.
-- Kept security-definer / service-role exactly as before.

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
  v_waking     jsonb;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = 'P0001';
  end if;

  select config into v_config from public.user_schedule where user_id = p_user_id;

  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'x', t.x, 'y', t.y,
             'due', t.due, 'due_time', t.due_time, 'staged', t.staged,
             'recurring', t.recurring, 'size', t.size
           )),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null   -- exclude permanently completed one-off tasks (survives daily reset)
      and (t.start_date is null or t.start_date <= p_local_date);  -- exclude dormant (paused) tasks

  -- Dormant tasks un-pausing within the look-ahead window (start_date strictly future, <= +3 days).
  -- These are heads-up material for the recap ONLY — deliberately NOT added to v_tasks above, so a
  -- paused task never re-enters the plan/board. Newest-first is meaningless here; order by soonest.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'id', t.id, 'text', t.text, 'start_date', t.start_date, 'due', t.due
           ) order by t.start_date),
           '[]'::jsonb
         )
    into v_waking
    from public.tasks t
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null
      and t.start_date is not null
      and t.start_date > p_local_date
      and t.start_date <= p_local_date + 3;

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
    'plan', v_plan,
    'waking', v_waking
  );
end;
$$;

-- Fence: service_role ONLY (restated so this file stands alone, matching 20260717120000).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;

-- Down path (manual reversal):
--   -- re-create dispatch_inputs_for_user from 20260717120000_task_start_date.sql (drops `waking`)
