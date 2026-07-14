-- Migration: give the dispatch crons a realistic pg_net timeout (fixes issue #250 false alarms)
--
-- Symptom: the cron-health check (.github/workflows/cron-health.yml) opened #250 for HTTP "error"
-- (null status_code) responses in net._http_response. Investigation showed the crons are healthy —
-- cron.job_run_details reports 180/180 succeeded for BOTH jobs, and sends land (an evening recap row
-- was written at :00:07, 2s AFTER pg_net gave up at :00:05). Every "error" row is `timed_out = true`
-- with `error_msg = 'Timeout of 5000 ms reached'`.
--
-- Root cause: both dispatch crons call net.http_post WITHOUT a timeout_milliseconds arg, so pg_net
-- uses its DEFAULT of 5000 ms. But the functions do their work INLINE inside the request pg_net holds
-- open, and that work routinely exceeds 5s: dispatch-messages generates the morning plan with a
-- synchronous Anthropic call (~9s), and even a deterministic recap + web-push round-trips (plus the
-- occasional cold start of dispatch-messages' heavy import graph) can cross 5s. pg_net then records
-- the response as a timeout "error" even though the edge function runs to completion server-side and
-- the notification still goes out. So the alerts are false positives from a too-short client timeout,
-- not a real dispatch failure.
--
-- Fix: re-schedule both jobs with timeout_milliseconds := 30000. pg_net is async — net.http_post
-- queues the request and returns immediately, so the cron SQL still completes instantly and jobs never
-- overlap; only pg_net's background worker waits longer before declaring a timeout. 30s comfortably
-- clears a normal plan generation / push while still catching a truly hung function. cron.schedule
-- upserts by job name, so this just replaces the two commands in place. The Vault-secret WHERE guards
-- are preserved verbatim, so the jobs stay no-ops on local/fresh stacks that haven't set the secrets.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal): re-run the two originating migrations' cron.schedule blocks
--   (20260709140000_dispatch_messages_pg_cron.sql, 20260709033335_task_reminders_pipeline.sql),
--   which schedule the same jobs without the timeout arg (reverting to the 5000 ms default).
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Proactive digest (morning plan + evening recap). Same body as 20260709140000, + a 30s pg_net timeout.
select cron.schedule(
  'dispatch-messages',
  '* * * * *',
  $$
  select net.http_post(
           url                  := s.url,
           headers              := jsonb_build_object(
                                     'Content-Type', 'application/json',
                                     'x-dispatch-secret', s.secret
                                   ),
           body                 := '{}'::jsonb,
           timeout_milliseconds := 30000
         )
    from (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_messages_url') as url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')        as secret
    ) s
   where s.url is not null and s.secret is not null
  $$
);

-- Per-task reminder sweep. Same body as 20260709033335, + a 30s pg_net timeout. This sweep is
-- deterministic and usually fast, but a cold start or a slow push endpoint can still cross 5s.
select cron.schedule(
  'dispatch-reminders',
  '* * * * *',
  $$
  select net.http_post(
           url                  := s.url,
           headers              := jsonb_build_object(
                                     'Content-Type', 'application/json',
                                     'x-dispatch-secret', s.secret
                                   ),
           body                 := '{}'::jsonb,
           timeout_milliseconds := 30000
         )
    from (
      select
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_reminders_url') as url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')         as secret
    ) s
   where s.url is not null and s.secret is not null
  $$
);
