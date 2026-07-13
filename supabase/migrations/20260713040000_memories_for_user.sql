-- Migration: memories_for_user
--
-- Intent: let the proactive dispatcher (dispatch-messages, service_role admin client) feed a user's
--   saved memories into their morning Plan My Day — the push counterpart of the interactive path
--   (run-plan.ts / plan-my-day), which read assistant_memories directly under the caller's JWT (RLS).
--   The admin client has no table DML/SELECT grant (house rule), so it reaches per-user memories only
--   through this SECURITY DEFINER RPC, fenced to service_role — the same shape as push_subscriptions_for_user
--   (20260707150000) and the other *_for_user RPCs.
--
--   The kill switch is enforced HERE too: when config.assistant.memoryEnabled is exactly `false`,
--   the RPC returns an empty array, so a user who turned memory off never has memories injected into
--   the push plan either (absent/true ⇒ on, the same default the app + chat-context use).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.memories_for_user(uuid);
-- ----------------------------------------------------------------------------

create or replace function public.memories_for_user(p_user_id uuid)
returns text[]
language sql
security definer
set search_path = public
as $$
  select case
    when (
      select config -> 'assistant' ->> 'memoryEnabled'
      from public.user_schedule
      where user_id = p_user_id
    ) = 'false'
      then array[]::text[]
    else coalesce(
      (
        select array_agg(content order by created_at)
        from public.assistant_memories
        where user_id = p_user_id
      ),
      array[]::text[]
    )
  end;
$$;

comment on function public.memories_for_user(uuid) is
  'Proactive-dispatch reader for a user''s saved memories (service_role only). Returns the memory '
  'contents oldest-first, or an empty array when config.assistant.memoryEnabled = false. Mirrors the '
  'interactive path''s RLS-scoped select so the morning push plan is personalized the same way.';

-- Fence to service_role (revoke the default public execute). Reached only by the dispatch backend.
revoke all on function public.memories_for_user(uuid) from public;
grant execute on function public.memories_for_user(uuid) to service_role;
