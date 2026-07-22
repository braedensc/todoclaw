-- Migration: weather_cache_service_only
--
-- Security fix (cross-tenant). The original weather_cache migration (20260624020000) granted the
-- DEFINER weather_cache_get/put functions to `authenticated` and reached the cache "under the
-- caller's JWT". But weather_cache is a GLOBAL, un-scoped table (PK = location, no user_id), and
-- weather_cache_put took an unbounded `text` payload with only an `auth.uid() is null` login check —
-- no ownership, no size cap. So ANY invited user could call, over PostgREST:
--
--   supabase.rpc('weather_cache_put', { p_location: '<a victim's city>', p_data: '<injection>' })
--
-- and (1) POISON another user's plan: getWeather() serves the cached value for the ~30min TTL and
-- plan-my-day / run-plan fold it verbatim into that victim's Anthropic prompt (=== WEATHER ===), so
-- attacker text reaches another user's LLM; and (2) STORAGE-BOMB the table with unbounded distinct
-- location keys × unbounded payloads that carry no owner to clean up per-user.
--
-- Fix: the weather cache is now SERVER-ONLY. The client/user never writes (or reads) it directly.
--   * Both functions are revoked from public/authenticated and granted ONLY to service_role. The
--     edge functions (plan-my-day, run-plan) call them with an adminClient() — the same service_role
--     path already used for the chat-transcript DEFINER RPCs. The cached VALUE is now always the
--     summary the FUNCTION itself fetched from wttr.in (or a fixed sentinel), never client text, so
--     the poisoning vector is closed at the source: a user can influence which location key gets a
--     real forecast, never what string is stored under it.
--   * The `auth.uid() is null` guard is removed: service_role has a null auth.uid(), so that check
--     would now (wrongly) reject the ONLY legitimate caller. The EXECUTE grant IS the fence.
--   * weather_cache_put caps p_data (defense-in-depth against a runaway payload; real summaries are
--     ~80 chars). The prompt builder additionally sanitizes+caps the cached text before folding it
--     (plan-prompt.ts), so even a value cached before this migration can't break prompt structure.
--   * The table is truncated to flush any poison / bomb rows an attacker may already have written.
--
-- Down path (manual reversal — restores the pre-fix, VULNERABLE grants; do not use except to roll
-- back this migration):
--   revoke execute on function public.weather_cache_get(text, integer) from service_role;
--   revoke execute on function public.weather_cache_put(text, text) from service_role;
--   grant  execute on function public.weather_cache_get(text, integer) to authenticated;
--   grant  execute on function public.weather_cache_put(text, text) to authenticated;
--   -- and restore the `if auth.uid() is null then raise ... end if;` guard in both bodies.

-- Redefine both functions: drop the now-wrong auth.uid() guard, cap the put payload. `create or
-- replace` preserves the existing ACL, so the grants below are what actually change access.
create or replace function public.weather_cache_get(p_location text, p_max_age_seconds integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data text;
begin
  -- No auth.uid() check: this is reachable only by service_role (see grants below), whose auth.uid()
  -- is null. The EXECUTE grant is the access boundary.
  select data into v_data
    from public.weather_cache
    where location = p_location
      and fetched_at > now() - make_interval(secs => p_max_age_seconds);
  return v_data;
end;
$$;

create or replace function public.weather_cache_put(p_location text, p_data text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role only (see grants). Cap the payload as defense-in-depth: real summaries run ~80
  -- chars and the not-found sentinel is short, so 2000 is generous headroom while bounding a bug or
  -- abuse from ballooning a row.
  insert into public.weather_cache (location, data)
  values (p_location, left(p_data, 2000))
  on conflict (location) do update
    set data = excluded.data, fetched_at = now();
end;
$$;

-- Revoke the vulnerable authenticated (and public) access; grant only to service_role.
revoke execute on function public.weather_cache_get(text, integer) from public, authenticated;
revoke execute on function public.weather_cache_put(text, text) from public, authenticated;
grant  execute on function public.weather_cache_get(text, integer) to service_role;
grant  execute on function public.weather_cache_put(text, text) to service_role;

-- Flush any cache rows written before this fix (poison text or bomb rows). It is only a cache; it
-- refills from wttr.in on the next plan run.
truncate table public.weather_cache;

comment on table public.weather_cache is
  'Shared ~30min cache of wttr.in weather for Plan My Day. Global (not user-scoped); RLS on with no '
  'grants/policies. SERVER-ONLY: the DEFINER weather_cache_get/put functions are granted to '
  'service_role only (never authenticated) — the edge functions write it via adminClient after '
  'fetching wttr.in themselves; clients never read or write it directly.';
