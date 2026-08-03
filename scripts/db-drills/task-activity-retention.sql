-- task-activity-retention.sql — psql drill proving the task_activity self-prune (#307) holds
-- under write spam without ever blocking the user's task writes.
--
-- Threat: task_activity is written by the SECURITY DEFINER log_task_activity() trigger on every
-- task write, so grants can't bound it — and task UPDATES have no volume cap (#312 caps rows, not
-- updates). A curl loop of task edits is therefore free to hammer the trigger; the retention
-- DELETE inside the trigger is the only thing keeping the log finite. This drill exercises that
-- exact abuse path end to end. (The static CI tripwire for the same invariants is
-- src/lib/task-activity-retention.test.ts.)
--
-- What it proves, in order:
--   1. BOUNDED   — v_keep+200 rename-spam updates as `authenticated` leave EXACTLY v_keep rows;
--                  the loop completing at all is the no-blocking proof (retention is a DELETE,
--                  never a raise — a raise would abort the user's edit).
--   2. COLLAPSED — the original abuse example, a rapid loop of cross-quadrant grid moves,
--                  collapses to ONE positioning row via the trigger's 10s de-noise window.
--   3. READERS   — after the spam, both readers still see the newest action:
--                  task_activity_for_user() (evening recap: the whole local day, ≤ v_keep by
--                  construction) and the chat-context shape (newest 50).
--   4. SCOPED    — user B's log is untouched by user A's spam (the prune is per-user).
--   5. SUPPRESSED— the todoclaw.suppress_activity GUC (set by restore_backup's bulk path)
--                  silences logging; clearing it resumes.
--
-- Run against the local stack (`supabase start` first):
--   docker exec -i supabase_db_todoclaw psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < scripts/db-drills/task-activity-retention.sql
--
-- The whole drill is ONE transaction ending in ROLLBACK — zero residue, safe to re-run. A failed
-- assert aborts the transaction, so nothing sticks on failure either. Note: the created_at
-- default swap below holds a brief exclusive lock on task_activity until the rollback, so run it
-- when nothing else is hammering the local DB.

\set ON_ERROR_STOP on

begin;

-- created_at defaults to now() — the TRANSACTION timestamp — which would tie every row written by
-- this single-txn drill. Real actions are one transaction each (distinct timestamps), so restore
-- that shape for the ordering-sensitive asserts. Transaction-local: rolls back with everything.
alter table public.task_activity alter column created_at set default clock_timestamp();

-- Drill identities as txn-local GUCs (psql :variables don't interpolate inside DO bodies).
select set_config('drill.uid_a',      gen_random_uuid()::text, true),
       set_config('drill.uid_b',      gen_random_uuid()::text, true),
       set_config('drill.task_spam',  gen_random_uuid()::text, true),
       set_config('drill.task_mover', gen_random_uuid()::text, true),
       set_config('drill.task_b',     gen_random_uuid()::text, true),
       set_config('drill.tz',         'America/New_York',      true);

-- ── Seed (as postgres): two users, a schedule for A (the recap RPC inner-joins user_schedule),
--    and three tasks. The three INSERTs already log three 'created' rows via the trigger.
do $seed$
begin
  insert into auth.users (id)
  values (current_setting('drill.uid_a')::uuid), (current_setting('drill.uid_b')::uuid);

  insert into public.user_schedule (user_id, timezone)
  values (current_setting('drill.uid_a')::uuid, current_setting('drill.tz'));

  insert into public.tasks (id, user_id, text, x, y, staged)
  values
    (current_setting('drill.task_spam')::uuid,  current_setting('drill.uid_a')::uuid, 'spam target',  null, null, true),
    (current_setting('drill.task_mover')::uuid, current_setting('drill.uid_a')::uuid, 'mover target', 0.2,  0.8,  false),
    (current_setting('drill.task_b')::uuid,     current_setting('drill.uid_b')::uuid, 'user B task',  null, null, true);

  raise notice '[seed] users + schedule + 3 tasks in (3 created rows logged)';
end
$seed$;

-- ── Become user A exactly the way PostgREST does: role + JWT-sub GUC (auth.uid() reads it).
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('drill.uid_a'), true);

-- ── Phase 1: BOUNDED. Rename-spam v_keep+200 times ('renamed' has no de-noise collapse, so every
--    update inserts a row — the loudest uncapped vector). RLS scopes the count to user A.
do $phase1$
declare
  v_keep int;
  v_n    int;
  i      int;
begin
  -- Read the retention constant from the LIVE function so the drill can never drift from the SQL.
  select (regexp_match(pg_get_functiondef('public.log_task_activity()'::regprocedure),
                       'v_keep\s+constant\s+int\s*:=\s*(\d+)'))[1]::int
    into v_keep;
  assert v_keep is not null, 'log_task_activity() no longer declares v_keep — retention dropped?';

  for i in 1 .. v_keep + 200 loop
    update public.tasks set text = 'spam rename #' || i
     where id = current_setting('drill.task_spam')::uuid;
  end loop;

  select count(*) into v_n from public.task_activity;   -- RLS: user A's rows only
  assert v_n = v_keep,
    format('expected exactly %s rows for user A after %s loggable writes, found %s',
           v_keep, v_keep + 202, v_n);
  raise notice '[1 BOUNDED] % spam renames -> exactly % rows retained, no write blocked',
    v_keep + 200, v_keep;
end
$phase1$;

-- ── Phase 2: COLLAPSED. 60 rapid cross-quadrant grid moves (x 0.8↔0.2 at y 0.8 = Do Now↔Schedule)
--    on one task collapse to a single positioning row inside the 10s de-noise window.
do $phase2$
declare
  v_pos int;
  i     int;
begin
  for i in 1 .. 60 loop
    update public.tasks set x = case when i % 2 = 1 then 0.8 else 0.2 end
     where id = current_setting('drill.task_mover')::uuid;
  end loop;

  select count(*) into v_pos from public.task_activity
   where task_id = current_setting('drill.task_mover')::uuid
     and kind in ('placed', 'moved');
  assert v_pos = 1, format('expected 1 collapsed positioning row for the mover, found %s', v_pos);
  raise notice '[2 COLLAPSED] 60 rapid cross-quadrant moves -> 1 positioning row';
end
$phase2$;

-- ── Phase 3a: the LAST action (a marker rename), then the chat-context read shape (newest 50,
--    RLS as the user) must surface it first.
do $phase3a$
declare
  v_first text;
begin
  update public.tasks set text = 'MARKER: THE FINAL RENAME'
   where id = current_setting('drill.task_spam')::uuid;

  select task_text into v_first
    from (select task_text from public.task_activity
           order by created_at desc limit 50) as chat_window
   limit 1;
  assert v_first = 'MARKER: THE FINAL RENAME',
    format('chat window newest row should be the marker, found %L', v_first);
  raise notice '[3a READERS] chat window (newest 50) leads with the marker action';
end
$phase3a$;

-- ── Phase 3b: the evening-recap RPC (service_role, whole local day) also survives the pruning:
--    bounded at v_keep and ending on the marker.
reset role;
set local role service_role;
do $phase3b$
declare
  v_keep  int;
  v_recap jsonb;
begin
  select (regexp_match(pg_get_functiondef('public.log_task_activity()'::regprocedure),
                       'v_keep\s+constant\s+int\s*:=\s*(\d+)'))[1]::int
    into v_keep;

  select public.task_activity_for_user(
           current_setting('drill.uid_a')::uuid,
           (clock_timestamp() at time zone current_setting('drill.tz'))::date)
    into v_recap;

  assert jsonb_array_length(v_recap) between 1 and v_keep,
    format('recap payload should be 1..%s rows, found %s', v_keep, jsonb_array_length(v_recap));
  assert v_recap -> -1 ->> 'task_text' = 'MARKER: THE FINAL RENAME',
    'recap payload should end on the newest (marker) action';
  raise notice '[3b READERS] recap RPC returns % rows (<= %), newest action intact',
    jsonb_array_length(v_recap), v_keep;
end
$phase3b$;

-- ── Phase 4: SCOPED. User A's spam never pruned (or grew) user B's log.
reset role;
do $phase4$
declare
  v_b int;
begin
  select count(*) into v_b from public.task_activity
   where user_id = current_setting('drill.uid_b')::uuid;
  assert v_b = 1, format('user B should still have exactly their 1 created row, found %s', v_b);
  raise notice '[4 SCOPED] user B untouched by user A''s spam (1 row)';
end
$phase4$;

-- ── Phase 5: SUPPRESSED. The txn-local GUC restore_backup sets before its bulk writes silences
--    the trigger entirely; clearing it resumes logging (still capped).
set local role authenticated;
do $phase5$
declare
  v_before int;
  v_after  int;
begin
  perform set_config('todoclaw.suppress_activity', 'on', true);
  select count(*) into v_before from public.task_activity;
  update public.tasks set text = 'suppressed rename — must not log'
   where id = current_setting('drill.task_spam')::uuid;
  select count(*) into v_after from public.task_activity;
  assert v_after = v_before, 'suppressed write must not add a row';
  assert not exists (select 1 from public.task_activity
                      where task_text = 'suppressed rename — must not log'),
    'the suppressed action must not appear in the log';

  perform set_config('todoclaw.suppress_activity', 'off', true);
  update public.tasks set text = 'post-suppress rename — logs again'
   where id = current_setting('drill.task_spam')::uuid;
  assert exists (select 1 from public.task_activity
                  where task_text = 'post-suppress rename — logs again'),
    'logging must resume once the GUC is cleared';
  raise notice '[5 SUPPRESSED] GUC on -> silent; GUC off -> logging resumes';
end
$phase5$;

rollback;

select 'TASK-ACTIVITY RETENTION DRILL PASSED — rolled back, zero residue' as result;
