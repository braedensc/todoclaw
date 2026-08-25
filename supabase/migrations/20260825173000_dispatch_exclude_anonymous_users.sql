-- Migration: dispatch_exclude_anonymous_users (TOD-84)
--
-- Intent: exclude anonymous auth users (auth.users.is_anonymous = true) from the proactive
-- dispatcher's candidate set, so a guest is never selected by notification_candidates() and never
-- reaches precheckForUser/recordUsageForUser — zero authenticated-ledger movement for guests via
-- the proactive path. Policy: guests get NO proactive AI; per-guest budgeting lives in a separate,
-- isolated ledger (TOD-47) and the interactive path is gated separately (TOD-50). This is the
-- proactive fence: cheapest and highest-blast-radius, so it lands first.
--
-- Recreated VERBATIM from 20260707150000_dispatch_rpcs.sql — every prior behavior is preserved
-- (enabled=true, ≥1 push subscription, returned columns/shape, service_role-only fence). Only the
-- NOT EXISTS on auth.users is new. Authenticated users' dispatch behavior is unchanged; an
-- anonymous row (is_anonymous = true) drops out at row-selection time.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   -- re-create notification_candidates() from 20260707150000_dispatch_rpcs.sql (drops the
--   -- anonymous-user exclusion).
-- ----------------------------------------------------------------------------

create or replace function public.notification_candidates()
returns table (user_id uuid, timezone text, notifications jsonb)
language sql
security definer
set search_path = public
as $$
  select us.user_id, us.timezone, us.config -> 'notifications'
  from public.user_schedule us
  where coalesce((us.config -> 'notifications' ->> 'enabled')::boolean, false) = true
    and exists (
      select 1 from public.push_subscriptions ps where ps.user_id = us.user_id
    )
    and not exists (
      -- Guests never get a proactive AI push (TOD-84). is_anonymous defaults to false, so a row
      -- with a null column (older auth schemas) is treated as authenticated, not anonymous.
      select 1 from auth.users au where au.id = us.user_id and au.is_anonymous = true
    );
$$;

-- Fence: service_role ONLY (restated so this file stands alone, matching 20260707150000).
revoke all on function public.notification_candidates() from public;
grant execute on function public.notification_candidates() to service_role;
