-- Migration: run the proactive digest on pg_cron (ADR-0031 reliability upgrade)
--
-- NOTE ON VERSION: this migration was introduced by PR #197 as 20260709130000, but PR #194 (merged
-- in parallel) shipped a DIFFERENT migration at the SAME 20260709130000 version — a collision that
-- errors `db push`/`db reset` (duplicate schema_migrations primary key) and meant this one never
-- applied anywhere. Renumbered to 20260709140000 (it had not applied to prod) to break the tie.
--
-- Intent: trigger the proactive-digest dispatcher (morning plan + evening recap) from pg_cron +
-- pg_net instead of relying on the GitHub Actions cron (.github/workflows/notify.yml). This is the
-- "tighter-timing upgrade path" ADR-0031 reserved and that the task_reminders pipeline
-- (20260709033335) already runs on. GitHub's scheduled workflows silently DROP most ticks under
-- load — observed in prod: only ~9 of 24 hourly ticks fired on a normal day, and the 12:00/13:00 UTC
-- ticks (the 8am/9am US-Eastern morning hours) were repeatedly among the skipped ones. Because
-- dueKind() only sends when a tick lands in the user's local send-window, a dropped tick lost that
-- user's push for the whole day. pg_cron fires from inside Postgres, reliably.
--
-- Cadence — EVERY MINUTE (not hourly): the FUNCTION only pushes when a user's LOCAL hour is in their
-- send-window, and claim_message caps the send — and the AI plan generation — at once per (user,
-- local_date, kind). So almost every tick is a cheap no-op (one notification_candidates() query, no
-- push, no model call). Per-minute buys two things the digest is supposed to guarantee: it delivers
-- at the TOP of the user's chosen hour (not up to an hour later), and if a tick is ever dropped the
-- miss is recovered on the NEXT minute rather than the next hour. dispatch.ts's 4h catch-up window
-- still bounds how late a recovered send may be. Matches the dispatch-reminders sweep, which has run
-- at '* * * * *' in prod since 20260709033335.
--
-- Belt-and-suspenders: notify.yml stays as a redundant BACKUP trigger — both POST the same function
-- and claim_message dedupes, so the two triggers can never double-send.
--
-- Setup (one-time, owner, SQL editor) — the job is a NO-OP until both Vault secrets exist. The shared
-- dispatch_secret is ALREADY set (dispatch-reminders uses it); only the URL is new:
--   select vault.create_secret(
--     'https://<prod-ref>.supabase.co/functions/v1/dispatch-messages', 'dispatch_messages_url');
-- The URL is not a secret — it is the same value as the DISPATCH_URL repo variable. cron.schedule
-- upserts by job name, so re-running this migration is safe.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   select cron.unschedule('dispatch-messages');
--   -- and, if fully retiring it:
--   -- select vault.delete_secret(id) from vault.secrets where name = 'dispatch_messages_url';
-- ----------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Every minute (UTC); the FUNCTION decides who is due by matching each user's LOCAL send-window
-- (dispatch.ts), reading its own URL secret (dispatch_messages_url) so the two dispatchers point at
-- their own functions.
select cron.schedule(
  'dispatch-messages',
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
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_messages_url') as url,
        (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')        as secret
    ) s
   where s.url is not null and s.secret is not null
  $$
);
