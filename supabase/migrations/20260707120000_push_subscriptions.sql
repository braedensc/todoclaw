-- Migration: push_subscriptions
--
-- Intent: store the Web Push subscriptions a user has opted into (ADR-0031) — one row per browser
-- push endpoint. This is the delivery address book for the proactive daily messages: the
-- dispatch-messages cron looks up a due user's subscription(s) here and encrypts a push to each
-- (RFC 8291, see _shared/web-push.ts).
--
-- Access model:
--   • The CLIENT manages only its own rows via owner-scoped RLS: it inserts on subscribe, upserts on
--     `pushsubscriptionchange` (endpoint is the unique conflict target), and deletes on unsubscribe.
--     DELETE is granted here (unlike tasks/daily_state) because a dead push endpoint is disposable
--     plumbing, not user content or history — there is nothing to preserve.
--   • The SYSTEM (dispatch-messages) never uses direct DML here: Supabase's `service_role` bypasses
--     RLS but NOT table GRANTs, and it holds no DML grant on app tables by design. It reads a due
--     user's subscriptions and prunes gone (404/410) endpoints through SECURITY DEFINER RPCs granted
--     to `service_role` only (the ADR-0030 pattern), added alongside the dispatcher. None of that
--     lives here — this migration is the client-facing table.
--
-- p256dh / auth are the subscription's public key + auth secret exactly as the browser's
-- PushSubscription exposes them (base64url); they are per-endpoint delivery material, not user
-- secrets — a leaked pair lets someone send that browser an (undeliverable-without-VAPID) push, not
-- read anything. RLS still scopes them to the owner.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop table if exists public.push_subscriptions;   -- (drops its trigger + policies with it)
-- ----------------------------------------------------------------------------

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique,          -- the push service URL; unique per browser subscription
  p256dh      text not null,                 -- base64url UA public key (PushSubscription.keys.p256dh)
  auth        text not null,                 -- base64url UA auth secret  (PushSubscription.keys.auth)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'Web Push subscriptions (ADR-0031): one row per browser push endpoint. Owner-scoped RLS lets the '
  'client add/refresh/remove its own; the dispatcher reads/prunes across users via service_role-only '
  'DEFINER RPCs (added with dispatch-messages), since service_role has no direct table DML.';

-- The system fetches every subscription for a due user; the client re-reads its own.
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Keep updated_at fresh on refresh (reuses the shared trigger fn from 20260623204450_create_user_schedule).
create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

-- Owner-scoped: the client manages only its own subscriptions. DELETE is intentionally granted
-- (unsubscribe removes the row); system-side prune bypasses these via service_role.
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create policy "push_subscriptions_select_own"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = auth.uid());

create policy "push_subscriptions_insert_own"
  on public.push_subscriptions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "push_subscriptions_update_own"
  on public.push_subscriptions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "push_subscriptions_delete_own"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = auth.uid());
