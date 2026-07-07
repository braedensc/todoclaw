-- Migration: invites
--
-- Intent: owner-generated, redeemable invite codes so the owner can onboard a new user by
-- texting them a code/link — no Supabase dashboard, no needing their email up front (ADR-0029).
-- `enable_signup` stays FALSE: this does NOT reopen public self-registration. Accounts are
-- created only by the redeem-invite Edge Function, via the service-role admin API, and ONLY when
-- a valid, unexpired, unrevoked, not-used-up code is presented. An invite code is effectively a
-- bearer token that spends the owner's Anthropic key (every account is trusted — ADR-0014/0015),
-- so codes are high-entropy (generated in the function), single-use by default, expiring, and
-- revocable; the existing monthly budget kill-switch remains the ultimate backstop.
--
-- Three tables:
--   (a) public.invites            — one row per code, owner-scoped via RLS (list / revoke).
--   (b) public.invite_redemptions — one row per successful redemption (audit; supports max_uses>1).
--   (c) public.invite_attempts    — per-IP redeem-attempt log behind a throttle (no grants/policies).
--
-- Three functions, all SECURITY DEFINER and locked to `service_role` (revoked from public): the
-- claim/throttle/release logic is reachable ONLY through the redeem-invite Edge Function's admin
-- client, never the public PostgREST API. This mirrors the ai_budget_ledger pattern — sensitive
-- state is fenced behind DEFINER RPCs rather than exposed to anon/authenticated.
--   • claim_invite_code       — atomic (row-locked) check-then-increment; the redeem gate.
--   • release_invite_claim    — undo an increment if account creation then fails (don't burn a code).
--   • record_invite_redemption — write the audit row (so invite_redemptions needs no DML grant).
--   • invite_throttle         — per-IP rate limit (defense-in-depth; entropy is the primary control).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.invite_throttle(text, integer, integer);
--   drop function if exists public.record_invite_redemption(uuid, uuid);
--   drop function if exists public.release_invite_claim(uuid);
--   drop function if exists public.claim_invite_code(text);
--   drop table if exists public.invite_attempts;
--   drop table if exists public.invite_redemptions;
--   drop table if exists public.invites;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- (a) invites — owner-scoped codes (RLS: own rows for list/revoke)
-- ============================================================================

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code        text not null unique,                 -- high-entropy token, generated in the function
  max_uses    integer not null default 1 check (max_uses >= 1),
  used_count  integer not null default 0 check (used_count >= 0),
  expires_at  timestamptz,                           -- set by the function (e.g. now() + 7 days)
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.invites is
  'Owner-generated invite codes (ADR-0029). One row per code; single-use by default (max_uses=1). '
  'Redemption (used_count increment) is done by claim_invite_code under service_role, not RLS — '
  'the owner-scoped policies here are only for listing/revoking their own codes.';

create index invites_owner_created_idx on public.invites (owner_id, created_at desc);

alter table public.invites enable row level security;

-- select/insert/update own only. No delete: revoking is an UPDATE (revoked=true), and codes are
-- kept for audit. Redemption bypasses these policies via the DEFINER RPC (service_role).
grant select, insert, update on public.invites to authenticated;

create policy "invites_select_own"
  on public.invites for select
  to authenticated
  using (owner_id = auth.uid());

create policy "invites_insert_own"
  on public.invites for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "invites_update_own"
  on public.invites for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ============================================================================
-- (b) invite_redemptions — one row per successful redemption (audit)
-- ============================================================================

create table public.invite_redemptions (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.invites (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  redeemed_at timestamptz not null default now()
);

comment on table public.invite_redemptions is
  'Audit: one row per successful invite redemption. Inserted by redeem-invite under service_role '
  '(bypasses RLS). The owner may read redemptions for their own invites via the policy below.';

create index invite_redemptions_invite_idx on public.invite_redemptions (invite_id);

alter table public.invite_redemptions enable row level security;

-- Read-only for the owner, scoped to their own invites. Inserts come from the service-role admin
-- client only (no insert/update/delete grant to app roles).
grant select on public.invite_redemptions to authenticated;

create policy "invite_redemptions_select_own"
  on public.invite_redemptions for select
  to authenticated
  using (
    exists (
      select 1 from public.invites i
      where i.id = invite_redemptions.invite_id
        and i.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- (c) invite_attempts — per-IP redeem throttle log (DEFINER-only, like ai_budget_ledger)
-- ============================================================================

create table public.invite_attempts (
  id           uuid primary key default gen_random_uuid(),
  ip           text not null,
  attempted_at timestamptz not null default now()
);

comment on table public.invite_attempts is
  'Per-IP redeem-attempt log behind invite_throttle. RLS on with NO grants/policies → invisible to '
  'app roles; reachable only via the DEFINER throttle function. Append-only; reads are time-windowed '
  'so stale rows are harmless (no cron reset needed).';

create index invite_attempts_ip_time_idx on public.invite_attempts (ip, attempted_at desc);

alter table public.invite_attempts enable row level security;
-- Intentionally NO grants and NO policies: unreachable by anon/authenticated.

-- ============================================================================
-- Functions (SECURITY DEFINER; execute granted to service_role ONLY)
-- ============================================================================

-- Atomic redeem gate. Row-locks the code (FOR UPDATE) so concurrent redemptions of the last use
-- can't both succeed, checks revoked/expired/used-up, then increments used_count. Returns a
-- jsonb status the Edge Function maps to an HTTP code. On 'ok' also returns the invite id so a
-- later createUser failure can be released.
create or replace function public.claim_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
begin
  select * into v_invite from public.invites where code = p_code for update;
  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_invite.revoked then
    return jsonb_build_object('status', 'revoked');
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if v_invite.used_count >= v_invite.max_uses then
    return jsonb_build_object('status', 'used_up');
  end if;

  update public.invites set used_count = used_count + 1 where id = v_invite.id;
  return jsonb_build_object('status', 'ok', 'invite_id', v_invite.id);
end;
$$;

-- Undo a claim's increment when account creation fails after a successful claim, so a transient
-- error (or a duplicate email) doesn't permanently burn a use. Clamps at zero.
create or replace function public.release_invite_claim(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.invites
    set used_count = greatest(used_count - 1, 0)
    where id = p_invite_id;
end;
$$;

-- Record a successful redemption (audit). Runs as owner so invite_redemptions needs NO DML grant
-- to any app role — reads stay owner-scoped via RLS, writes come only through here.
create or replace function public.record_invite_redemption(p_invite_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.invite_redemptions (invite_id, user_id)
  values (p_invite_id, p_user_id);
end;
$$;

-- Per-IP throttle for the public redeem endpoint (defense-in-depth; code entropy is the primary
-- control). Returns true if under the limit (and records the attempt), false if over. A missing
-- IP is allowed but not recorded — a stripped header must neither bypass nor lock out redemption.
create or replace function public.invite_throttle(
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
    return true;
  end if;
  select count(*) into v_count
    from public.invite_attempts
    where ip = p_ip
      and attempted_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.invite_attempts (ip) values (p_ip);
  return true;
end;
$$;

-- Fence the RPCs behind service_role only: no anon/authenticated PostgREST access. The redeem
-- Edge Function calls them through its service-role admin client.
revoke all on function public.claim_invite_code(text) from public;
revoke all on function public.release_invite_claim(uuid) from public;
revoke all on function public.record_invite_redemption(uuid, uuid) from public;
revoke all on function public.invite_throttle(text, integer, integer) from public;

grant execute on function public.claim_invite_code(text) to service_role;
grant execute on function public.release_invite_claim(uuid) to service_role;
grant execute on function public.record_invite_redemption(uuid, uuid) to service_role;
grant execute on function public.invite_throttle(text, integer, integer) to service_role;
