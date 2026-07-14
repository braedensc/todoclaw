-- Migration: chat_sessions + chat_messages
--
-- Intent: PERSISTENT BabyClaw chats. Today the conversation is client-held (ai-chat resends the whole
--   Anthropic message array every turn); a refresh loses it. This makes the transcript durable and
--   SERVER-AUTHORITATIVE, so the client never mints history — it only reads + deletes.
--
-- The load-bearing security decision (ADR 2026-07-13-persistent-chats): the browser has NO write path
--   to these tables. If `authenticated` held INSERT on chat_messages, a hostile/XSS'd client could
--   PostgREST-insert a role='assistant' row (or forge `pending`), which then replays into every future
--   model window and can substitute what a confirmation executes. So:
--     • CLIENT: SELECT + owner-scoped hard-DELETE only. No INSERT, no UPDATE. (delete = "delete any
--       conversation"; deleting a session cascades to its messages.)
--     • SYSTEM: all transcript writes go through SECURITY DEFINER RPCs fenced to service_role
--       (chat_start_session / chat_append_message / chat_set_pending), exactly the claim_message
--       pattern (20260707130000_messages.sql). The RPC stamps role/user_id server-side, so the model
--       (or a forged client) can never mint an assistant turn or forge the confirmation state.
--   ai-chat gains a second client for this — a service_role admin handle used ONLY for these RPCs;
--   all TOOL DB writes keep using the caller JWT (RLS). Boundedness, not trust.
--
-- Caps are enforced at the DB as belt-and-suspenders (mirror assistant_memories_cap): ≤100 sessions
--   per user, ≤2000 messages per session, and per-row jsonb size CHECKs — since the browser has no
--   INSERT path, the edge-function caps are already authoritative, but the triggers backstop a bug.
--
-- Hard delete (no deleted_at) — "delete means delete" + the promised "delete any conversation". Same
--   class as history_delete_own / push_subscriptions / assistant_memories. NOT snapshotted by
--   create_backup/restore_backup (AI meta, like history/daily_state) and EXCLUDED from the external
--   pg_dump (backup.yml) so deleted chats don't linger in rotated dumps.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.chat_set_pending(uuid, uuid, jsonb);
--   drop function if exists public.chat_append_message(uuid, uuid, text, jsonb, jsonb);
--   drop function if exists public.chat_start_session(uuid, text);
--   drop trigger if exists chat_messages_cap on public.chat_messages;
--   drop function if exists public.chat_messages_cap_check();
--   drop trigger if exists chat_sessions_cap on public.chat_sessions;
--   drop function if exists public.chat_sessions_cap_check();
--   drop table if exists public.chat_messages;   -- policies + indexes drop with it
--   drop table if exists public.chat_sessions;    -- messages cascade
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Tables
-- ============================================================================

create table public.chat_sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text,
  -- Halted-confirmation state: { awaiting: {tool_use_id,name,summary}, approved: string[] } or null.
  -- Written ONLY by chat_set_pending (service_role); the client reads it to resume a pending confirm.
  pending    jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_sessions_pending_size check (pending is null or pg_column_size(pending) <= 8192)
);

comment on table public.chat_sessions is
  'One BabyClaw conversation. Rows are SERVER-written via chat_start_session (service_role); the '
  'client reads + hard-deletes only. `pending` holds a halted-confirmation state for resume. Hard '
  'delete cascades to chat_messages. Not backed up; excluded from external pg_dump.';

create table public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Global monotonic order key: ordering by seq within a session is exact chronological order.
  seq        bigint generated always as identity,
  -- Anthropic has no "tool" role — tool_results live in a user turn's content array.
  role       text not null check (role in ('user', 'assistant')),
  -- The exact Anthropic MessageParam `content` (string for a plain user turn, or a content-block
  -- array). This is what the server reloads and replays into the model window.
  content    jsonb not null,
  -- UI sidecar (NOT sent to the model): the bare user words for a seed-folded turn, or the per-tool
  -- display lines for a tool_result turn. Lets the history UI render without re-deriving from content.
  meta       jsonb,
  created_at timestamptz not null default now(),
  constraint chat_messages_content_size check (pg_column_size(content) <= 65536),
  constraint chat_messages_meta_size check (meta is null or pg_column_size(meta) <= 16384)
);

comment on table public.chat_messages is
  'Durable Anthropic-format transcript for a chat_session. System-written via chat_append_message '
  '(service_role) — the client has NO insert/update path, so an assistant turn can never be forged. '
  'Client reads + deletes own. `content` replays into the model window; `meta` is a UI-only sidecar.';

-- Hot reads: sessions newest-first per user (history list); messages in order within a session.
create index chat_sessions_user_updated_idx on public.chat_sessions (user_id, updated_at desc);
create index chat_messages_session_seq_idx on public.chat_messages (session_id, seq);

-- ============================================================================
-- RLS — client reads + hard-deletes own; NO insert/update grant (writes are service_role DEFINER)
-- ============================================================================

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

grant select, delete on public.chat_sessions to authenticated;
grant select, delete on public.chat_messages to authenticated;

create policy "chat_sessions_select_own" on public.chat_sessions
  for select to authenticated using (user_id = auth.uid());
create policy "chat_sessions_delete_own" on public.chat_sessions
  for delete to authenticated using (user_id = auth.uid());

create policy "chat_messages_select_own" on public.chat_messages
  for select to authenticated using (user_id = auth.uid());
create policy "chat_messages_delete_own" on public.chat_messages
  for delete to authenticated using (user_id = auth.uid());

-- ============================================================================
-- Cap triggers (belt-and-suspenders — the browser has no INSERT path, so the edge-function caps are
-- already authoritative; these backstop a bug). Mirror assistant_memories_cap_check.
-- ============================================================================

-- ≤100 sessions/user. A tiny race (two concurrent creates → 101) is acceptable — this bounds storage,
-- not billing. ai-chat maps the raise to a friendly "too many conversations" error.
create function public.chat_sessions_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.chat_sessions where user_id = new.user_id) >= 100 then
    raise exception 'chat_session_cap_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger chat_sessions_cap
  before insert on public.chat_sessions
  for each row execute function public.chat_sessions_cap_check();

-- ≤2000 messages/session. A very long conversation should be a new chat well before this.
create function public.chat_messages_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.chat_messages where session_id = new.session_id) >= 2000 then
    raise exception 'chat_message_cap_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger chat_messages_cap
  before insert on public.chat_messages
  for each row execute function public.chat_messages_cap_check();

-- ============================================================================
-- Write RPCs — SECURITY DEFINER, fenced to service_role (the claim_message pattern). Every RPC that
-- takes p_user_id also fences the session to it (defense in depth on top of the service_role grant),
-- so even a bug in the admin client can't cross tenants.
-- ============================================================================

-- Create a session for a user; returns its id. Title is stored trimmed (empty → null). The cap
-- trigger fires here.
create or replace function public.chat_start_session(
  p_user_id uuid,
  p_title   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.chat_sessions (user_id, title)
  values (p_user_id, nullif(btrim(p_title), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Append one message to a session and bump the session's updated_at. Returns the new seq. Stamps
-- role/user_id server-side (the client cannot). Fences the session to p_user_id.
create or replace function public.chat_append_message(
  p_session uuid,
  p_user_id uuid,
  p_role    text,
  p_content jsonb,
  p_meta    jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  if p_role not in ('user', 'assistant') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chat_sessions where id = p_session and user_id = p_user_id
  ) then
    raise exception 'chat_session_not_found' using errcode = 'P0002';
  end if;
  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (p_session, p_user_id, p_role, p_content, p_meta)
  returning seq into v_seq;
  update public.chat_sessions set updated_at = now() where id = p_session;
  return v_seq;
end;
$$;

-- Set (or clear, with null) a session's halted-confirmation state. Fences the session to p_user_id.
create or replace function public.chat_set_pending(
  p_session uuid,
  p_user_id uuid,
  p_pending jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
    set pending = p_pending, updated_at = now()
    where id = p_session and user_id = p_user_id;
  if not found then
    raise exception 'chat_session_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Fence all three behind service_role; ai-chat reaches them through its admin client.
revoke all on function public.chat_start_session(uuid, text) from public;
revoke all on function public.chat_append_message(uuid, uuid, text, jsonb, jsonb) from public;
revoke all on function public.chat_set_pending(uuid, uuid, jsonb) from public;
grant execute on function public.chat_start_session(uuid, text) to service_role;
grant execute on function public.chat_append_message(uuid, uuid, text, jsonb, jsonb) to service_role;
grant execute on function public.chat_set_pending(uuid, uuid, jsonb) to service_role;
