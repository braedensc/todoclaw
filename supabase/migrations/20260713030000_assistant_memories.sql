-- Migration: assistant_memories
--
-- Intent: durable per-user FACTS BabyClaw learns in chat ("works out most mornings"), the second
--   deliberate bounded model-writable prompt surface after user_schedule.config.assistant (see
--   capabilities/preferences.ts). Rendered into the chat system prompt as DATA — never instructions
--   — and fully user-curated from Settings → AI. The safety property is BOUNDEDNESS, enforced here
--   AND in capability code (never trusted from the model):
--     • per-memory length: CHECK 1..240 chars
--     • per-user count:    trigger caps at 30 rows
--     • dedup:             unique index on the normalized content line
--   All DB access is the caller's JWT (RLS); user_id defaults to auth.uid() and is never client-set.
--
-- HARD delete (a deliberate departure from ADR-0005 soft-delete): "forget that" must actually
-- forget. Memories are AI meta a user must be able to erase about themselves — same class as
-- history_delete_own (20260705000000) and push_subscriptions (20260707120000), which both carry an
-- owner-scoped DELETE for exactly this reason. Not captured by create_backup/restore_backup (this is
-- AI meta, not planner content — like history/daily_state), and excluded from the external pg_dump.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop trigger if exists assistant_memories_cap on public.assistant_memories;
--   drop function if exists public.assistant_memories_cap_check();
--   drop trigger if exists assistant_memories_set_updated_at on public.assistant_memories;
--   drop table if exists public.assistant_memories;  -- policies + indexes drop with it
-- ----------------------------------------------------------------------------

create table public.assistant_memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content    text not null
             constraint assistant_memories_content_len check (char_length(content) between 1 and 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.assistant_memories is
  'Durable per-user facts BabyClaw learns in chat, rendered into the chat system prompt as DATA '
  '(never instructions). User-curated in Settings. Caps: 30 rows/user, 240 chars each. Hard delete.';

-- Hot read: the full per-user list, oldest-first (a stable prompt order).
create index assistant_memories_user_created_idx
  on public.assistant_memories (user_id, created_at);

-- Dedup at the DB: one memory per normalized content line per user (the capability collapses
-- whitespace before writing, so lower(btrim(content)) is the canonical key).
create unique index assistant_memories_user_content_key
  on public.assistant_memories (user_id, lower(btrim(content)));

alter table public.assistant_memories enable row level security;

-- Owner-scoped RLS trio + DELETE (the push_subscriptions/history precedent): a user can only ever
-- read/insert/update/delete their OWN memories, and "forget" is a real hard delete. No service_role
-- DML anywhere — the chat capability writes through the caller's JWT like every other tool.
grant select, insert, update, delete on public.assistant_memories to authenticated;

create policy "assistant_memories_select_own" on public.assistant_memories
  for select to authenticated using (user_id = auth.uid());
create policy "assistant_memories_insert_own" on public.assistant_memories
  for insert to authenticated with check (user_id = auth.uid());
create policy "assistant_memories_update_own" on public.assistant_memories
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "assistant_memories_delete_own" on public.assistant_memories
  for delete to authenticated using (user_id = auth.uid());

-- Reuse the shared updated_at trigger fn (20260623204450_create_user_schedule.sql).
create trigger assistant_memories_set_updated_at
  before update on public.assistant_memories
  for each row execute function public.set_updated_at();

-- Row cap: 30 per user. SECURITY INVOKER (default) so the count runs under the caller's RLS; the
-- insert policy forces new.user_id = auth.uid(), so the count is exact for the owner. A tiny race
-- (two concurrent inserts → 31) is acceptable — this is a prompt-size guardrail, not billing. The
-- capability pre-checks the count for a friendly message; this trigger is the hard backstop.
create function public.assistant_memories_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.assistant_memories where user_id = new.user_id) >= 30 then
    raise exception 'memory_cap_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger assistant_memories_cap
  before insert on public.assistant_memories
  for each row execute function public.assistant_memories_cap_check();
