-- Intent: stop the proactive dispatcher (ADR-0031) from resurfacing a PERMANENTLY completed one-off
-- task. 20260709120000_task_completed_at.sql made one-off completion permanent via tasks.completed_at
-- (null = live, non-null = done) so a completion survives the daily reset — the client grid/list/mobile
-- surfaces (PR #191) hide any task with completed_at set. But dispatch_inputs_for_user still selected
-- every non-deleted task and the message builders only drop a task via TODAY's daily_state.done map,
-- which empties at local midnight. So a task completed on a PRIOR day (completed_at set, absent from
-- today's done map) leaked back into the next morning's push plan / ⏰ TODAY / board counts.
--
-- Fix: add `and t.completed_at is null` to the task select — one predicate, at the source, so every
-- downstream consumer of `tasks` (buildMorningFromPlan, buildMorningMessage, buildRecapMessage, and
-- buildPlanRequest via the morning plan generation) is clean without touching each builder.
--
-- Timestamped AFTER 20260709042000_dispatch_inputs_task_size.sql (the current RPC body: due_time +
-- size) and 20260709120000_task_completed_at.sql (which adds the column), so this replace LAYERS ON
-- the latest body — it keeps due_time + size + plan and only ADDS the completed_at predicate.
--
-- Down path (manual reversal):
--   -- re-create dispatch_inputs_for_user from 20260709042000_dispatch_inputs_task_size.sql
--   -- (i.e. drop the `and t.completed_at is null` predicate from the task select).

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
    where t.user_id = p_user_id
      and t.deleted_at is null
      and t.completed_at is null;   -- exclude permanently completed one-off tasks (survives daily reset)

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
-- file stands alone (matching 20260708000000 / 20260709041944 / 20260709042000).
revoke all on function public.dispatch_inputs_for_user(uuid, date) from public;
grant execute on function public.dispatch_inputs_for_user(uuid, date) to service_role;
