-- Migration: messages
--
-- Intent: the durable record of proactive daily messages (ADR-0031) — the morning plan and the
-- evening recap. This table, NOT the push, is the source of truth: push is best-effort on top, but a
-- message always lands here and backs an in-app inbox + unread badge (Realtime stays deferred,
-- ADR-0021 — the client reads on load/focus).
--
-- Idempotency lives in the schema, not in application logic. `unique (user_id, local_date, kind)`
-- means a user gets at most one plan and one recap per local day, and `claim_message` does the
-- insert as an atomic `on conflict do nothing returning id`: the dispatcher spends AI + sends a push
-- ONLY when a row id comes back. An overlapping or retried hourly cron re-runs the claim, gets NULL,
-- and skips — no double-send, no double-charge. The claim carries the (deterministic) content so a
-- claimed row is always complete even when AI is paused; the dispatcher may later enrich the body
-- with an AI version via a separate service_role RPC (added with dispatch-messages).
--
-- Access model:
--   • The CLIENT reads its own messages (inbox) and marks them read — nothing else. mark_message_read
--     is INVOKER (runs as the caller under RLS); the client is granted UPDATE only on `read_at`.
--   • The SYSTEM writes messages exclusively through `claim_message` (SECURITY DEFINER, execute granted
--     to service_role only, revoked from public) — the same fencing as ADR-0030's invite RPCs. There
--     is no INSERT/DELETE grant to app roles.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.mark_message_read(uuid);
--   drop function if exists public.claim_message(uuid, text, date, text, text, jsonb);
--   drop table if exists public.messages;
-- ----------------------------------------------------------------------------

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('plan', 'recap')),  -- morning plan | evening recap
  local_date  date not null,                                    -- the user's local calendar day
  title       text not null,
  body        text not null,
  data        jsonb,                                            -- optional structured payload (e.g. seed)
  read_at     timestamptz,                                      -- null = unread
  created_at  timestamptz not null default now(),
  unique (user_id, local_date, kind)
);

comment on table public.messages is
  'Proactive daily messages (ADR-0031): the durable source of truth behind the in-app inbox + unread '
  'badge. unique(user_id, local_date, kind) + claim_message make delivery idempotent (one plan + one '
  'recap per local day). System-written via claim_message (service_role); clients read + mark read.';

-- Inbox: newest-first per user; the unread badge filters read_at is null within this.
create index messages_user_created_idx on public.messages (user_id, created_at desc);

alter table public.messages enable row level security;

-- Read own; mark own read (read_at column only). No insert/delete for app roles — the system writes
-- via claim_message (DEFINER, service_role).
grant select on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

create policy "messages_select_own"
  on public.messages for select
  to authenticated
  using (user_id = auth.uid());

create policy "messages_update_own"
  on public.messages for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================================
-- claim_message — the atomic idempotency claim (SECURITY DEFINER, service_role only)
-- ============================================================================

-- Insert the day's message for a user, or do nothing if it already exists. Returns the new row id on
-- a fresh claim, NULL if this (user, local_date, kind) was already sent — the dispatcher branches on
-- that: id ⇒ generate AI + push; NULL ⇒ skip. The insert IS the claim, so two concurrent dispatches
-- can't both win (the unique index serializes them).
create or replace function public.claim_message(
  p_user_id    uuid,
  p_kind       text,
  p_local_date date,
  p_title      text,
  p_body       text,
  p_data       jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.messages (user_id, kind, local_date, title, body, data)
  values (p_user_id, p_kind, p_local_date, p_title, p_body, p_data)
  on conflict (user_id, local_date, kind) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ============================================================================
-- mark_message_read — client marks its own message read (SECURITY INVOKER)
-- ============================================================================

-- Server-stamped read_at so the client only passes an id; the RLS update policy + the read_at column
-- grant scope it to the caller's own unread rows. Idempotent (no-op if already read or not theirs).
create or replace function public.mark_message_read(p_id uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.messages
    set read_at = now()
    where id = p_id and user_id = auth.uid() and read_at is null;
$$;

-- Fence the claim behind service_role; the redeem/dispatch backends reach it via the admin client.
revoke all on function public.claim_message(uuid, text, date, text, text, jsonb) from public;
grant execute on function public.claim_message(uuid, text, date, text, text, jsonb) to service_role;

-- mark_message_read is app-facing (INVOKER, gated by RLS): available to signed-in users.
grant execute on function public.mark_message_read(uuid) to authenticated;
