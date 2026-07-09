-- Intent: carry the new task `size` (added in 20260709040000_add_task_size.sql) through the
-- proactive dispatcher so the pushed morning Plan My Day honors the same soft over-stuffing
-- guardrail as the interactive one. dispatch_inputs_for_user builds each task's jsonb with an
-- EXPLICIT key list (unlike a to_jsonb dump), so a new column is invisible to it until added here.
--
-- Timestamped AFTER 20260709041944_reminder_rpcs_and_dispatch_duetime.sql (which re-created this
-- same RPC to add `due_time`), so this replace LAYERS ON that version — it must keep `due_time` and
-- only ADD `'size', t.size`. Running earlier would let 041944 clobber size back out.

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
             'due', t.due, 'due_time', t.due_time, 'staged', t.staged,
             'recurring', t.recurring, 'size', t.size
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

-- Fence: service_role ONLY. CREATE OR REPLACE preserves the existing grant, but restate so this
-- file stands alone (matching 20260708000000 / 20260709041944).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;

-- Down path (manual reversal):
--   -- re-create dispatch_inputs_for_user from 20260709041944_reminder_rpcs_and_dispatch_duetime.sql
--   -- (i.e. drop `'size', t.size` from the task jsonb_build_object, keeping `due_time`).
