-- Migration: a generic per-IP throttle for the client-facing verify_jwt=false Edge Functions.
--
-- Intent: ai-status / plan-my-day / ai-chat / generate-invite / admin run with the platform gateway's
-- JWT check OFF (config.toml — needed so the CORS preflight isn't 401'd; they verify the JWT
-- themselves). That means an UNauthenticated request still reaches function code (and its auth
-- round-trip) before being turned away. Platform DDoS protection is the primary guard, but a coarse
-- app-level per-IP ceiling — checked BEFORE auth — is cheap defense-in-depth against a flood racking
-- up invocations. This generalizes invite_throttle (20260707044212) with a `bucket` so each function
-- gets its own budget. Limits are set generously at the call sites so shared NATs don't false-trip;
-- the goal is to clip egregious floods, not to rate-limit real use (per-user AI limits already do that).
--
-- Storage is self-bounding: edge_ip_throttle only INSERTs while a key is UNDER its limit and prunes
-- that key's expired rows on the way in, so a flooding IP adds at most `limit` rows per window and
-- then stops writing. The table is reachable ONLY through the SECURITY DEFINER function (RLS on, no
-- policies, no table grants), like invite_attempts.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.edge_ip_throttle(text, text, integer, integer);
--   drop table if exists public.edge_ip_events;  -- (drops its index with it)
-- ----------------------------------------------------------------------------

create table public.edge_ip_events (
  id      bigint generated always as identity primary key,
  bucket  text not null,               -- which function's budget (e.g. 'ai-chat')
  ip      text not null,               -- client IP (spoof-resistant source; see _shared/client-ip.ts)
  at      timestamptz not null default now()
);

comment on table public.edge_ip_events is
  'Per-IP request events for the coarse Edge-Function throttle (2026-07-22). One row per allowed '
  'request per (bucket, ip); written and read ONLY by the SECURITY DEFINER edge_ip_throttle function, '
  'which prunes expired rows per key so the table self-bounds. RLS on with no policies — no direct access.';

-- The throttle counts recent rows for one (bucket, ip); this index serves both the count and the prune.
create index edge_ip_events_lookup on public.edge_ip_events (bucket, ip, at desc);

alter table public.edge_ip_events enable row level security;
-- Intentionally NO policies and NO grants: the DEFINER function below is the only path in. anon /
-- authenticated therefore cannot read or write the table directly through PostgREST.

-- Atomic check-then-record, keyed on (bucket, ip). Returns true if the request is within budget (and
-- records it) or the IP is unknown (allow, don't record); false when the IP is over the limit. Mirrors
-- invite_throttle's shape. SECURITY DEFINER so it can reach the no-grant table; callable by anon
-- (unauthenticated requests arrive on the anon key) and authenticated.
create or replace function public.edge_ip_throttle(
  p_bucket         text,
  p_ip             text,
  p_limit          integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_ip is null or length(p_ip) = 0 then
    return true;  -- unknown IP (e.g. local serve) ⇒ neither bypass nor lock out
  end if;

  -- Housekeeping: drop this key's expired rows so the table can't accumulate for an active IP.
  delete from public.edge_ip_events
   where bucket = p_bucket and ip = p_ip
     and at <= now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
    from public.edge_ip_events
   where bucket = p_bucket and ip = p_ip
     and at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.edge_ip_events (bucket, ip) values (p_bucket, p_ip);
  return true;
end;
$$;

revoke all on function public.edge_ip_throttle(text, text, integer, integer) from public;
grant execute on function public.edge_ip_throttle(text, text, integer, integer)
  to anon, authenticated, service_role;
