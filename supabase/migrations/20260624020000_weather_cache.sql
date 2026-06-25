-- Migration: weather_cache
--
-- Intent: a tiny shared cache for the wttr.in weather used by Plan My Day (PR3). Edge Functions
-- are stateless across cold starts, so an in-process cache won't hold — this persists the last
-- fetch per location for ~30 min so repeated "Plan My Day" clicks don't hammer wttr.in.
--
-- Like ai_budget_ledger (ADR-0015), this is GLOBAL (not user-scoped) shared state, so RLS can't
-- express "only the system writes it": RLS is on with NO grants and NO policies → the table is
-- invisible to app roles, reachable ONLY via the SECURITY DEFINER get/put functions below. That
-- keeps the service-role key out of the function — the cache is reached via these RPCs under the
-- caller's JWT. Weather text is not sensitive; the DEFINER wrapper is for a consistent access
-- pattern, not secrecy.
--
-- Down path (manual reversal):
--   drop function if exists public.weather_cache_put(text, text);
--   drop function if exists public.weather_cache_get(text, integer);
--   drop table if exists public.weather_cache;

create table public.weather_cache (
  location   text primary key,
  data       text not null,
  fetched_at timestamptz not null default now()
);

comment on table public.weather_cache is
  'Shared ~30min cache of wttr.in weather for Plan My Day. Global (not user-scoped); RLS on with '
  'no grants/policies, reachable only via the DEFINER weather_cache_get/put functions.';

alter table public.weather_cache enable row level security;
-- Intentionally NO grants and NO policies: reachable only via the DEFINER functions below.

-- Return cached data for p_location if it was fetched within p_max_age_seconds, else null
-- (the caller then fetches fresh from wttr.in and calls weather_cache_put).
create or replace function public.weather_cache_get(p_location text, p_max_age_seconds integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data text;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
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
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  insert into public.weather_cache (location, data)
  values (p_location, p_data)
  on conflict (location) do update
    set data = excluded.data, fetched_at = now();
end;
$$;

revoke all on function public.weather_cache_get(text, integer) from public;
revoke all on function public.weather_cache_put(text, text) from public;
grant execute on function public.weather_cache_get(text, integer) to authenticated;
grant execute on function public.weather_cache_put(text, text) to authenticated;
