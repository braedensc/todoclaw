-- Migration: move the proactive digest onto pg_cron (ADR-0031 reliability upgrade)
--
-- Intent: trigger the HOURLY proactive-digest dispatcher (morning plan + evening recap) from
-- pg_cron + pg_net instead of relying on the GitHub Actions cron (.github/workflows/notify.yml).
-- This is the "tighter-timing upgrade path" ADR-0031 reserved and that the task_reminders pipeline
-- (20260709033335) already runs on. GitHub's scheduled workflows silently DROP most hourly ticks
-- under load — observed in prod: only ~9 of 24 ticks fired on a normal day, and the 12:00/13:00 UTC
-- ticks (which are the 8am/9am US-Eastern morning hours) were repeatedly among the skipped ones.
-- Because dueKind() only sends when a tick lands in the user's local send-window, a dropped tick
-- lost that user's push for the whole day (no catch-up). pg_cron fires from inside Postgres, on
-- time, every hour — the same reliable minute-hand the reminder sweep already uses.
--
-- Belt-and-suspenders (both land in the SAME fix): notify.yml stays as a redundant BACKUP trigger —
-- both POST the same function and claim_message dedupes per (user, local_date, kind), so the two
-- triggers can never double-send — and dispatch.ts now delivers on ANY tick within a short catch-up
-- window at/after the send hour (not only the exact hour), so a single missed tick is recovered by
-- the next one instead of lost.
--
-- Setup (one-time, owner, SQL editor) — the job is a NO-OP until both Vault secrets exist. The
-- shared dispatch_secret is ALREADY set (dispatch-reminders uses it); only the URL is new:
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

-- Every hour on the hour (UTC); the FUNCTION decides who is due by matching each user's LOCAL
-- send-window (dispatch.ts). Mirrors the dispatch-reminders job (20260709033335) — same shared
-- secret, same no-op-until-configured guard — but hourly, and reading its own URL secret
-- (dispatch_messages_url) so the two dispatchers point at their own functions.
select cron.schedule(
  'dispatch-messages',
  '0 * * * *',
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
