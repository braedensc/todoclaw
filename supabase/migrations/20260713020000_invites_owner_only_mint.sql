-- Migration: invites_owner_only_mint
--
-- Intent: close L3 of the 2026-07-13 BabyClaw audit — invite creation was owner-only only in the
-- Edge Function. generate-invite checks isOwner() and caps maxUses ≤ 50 / expiresInDays ≤ 90, but it
-- inserts the row under the CALLER's JWT and relies on the RLS policy `invites_insert_own`
-- (with check owner_id = auth.uid()). Because `insert` is granted to `authenticated`, any signed-in
-- (invited, non-owner) user can skip the function and POST /rest/v1/invites directly with e.g.
-- { code, max_uses: 1000000, expires_at: null, owner_id: <self> } — the with-check is satisfied and
-- claim_invite_code (which never verifies owner_id is the real app owner) then honors the code. So a
-- trusted user could mint unlimited-use, non-expiring invites and onboard arbitrary accounts, each
-- spending the shared owner Anthropic budget. This defeats the "owner-vouched, invite-only" intent
-- (ADR-0030/0014) and compounds M2 (each new account is another sub-cap slice of the global pool).
--
-- Fix: make invite creation owner-only BELOW the Edge Function.
--   1. Revoke the direct INSERT grant on public.invites from `authenticated` and drop the
--      `invites_insert_own` policy. There is now NO PostgREST insert path for app roles — the only
--      way a row is created is generate-invite's service-role admin client (this migration's paired
--      Edge-Function change), which bypasses RLS and sets owner_id to the isOwner()-verified user.id.
--      select/update-own stay intact so the owner can still LIST and REVOKE (revoked=true) their codes.
--   2. Defense-in-depth CHECK constraints mirror the function's caps so even the owner path (or a
--      future admin bug) cannot mint an absurd code: max_uses ∈ [1, 50], and expires_at is required
--      (no never-expiring codes). The ≤ 90-day expiry bound stays in the function — a CHECK cannot
--      reference now() (not immutable), so the DB can require a bound to EXIST but not how far out.
--
-- No table is dropped and no data is rewritten (existing invite rows were all created by the owner
-- via generate-invite, which always set expires_at and max_uses ≤ 50, so the new CHECKs validate).
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the 20260707044212 grants/policy):
--   alter table public.invites drop constraint if exists invites_expires_at_required;
--   alter table public.invites drop constraint if exists invites_max_uses_bounded;
--   alter table public.invites add constraint invites_max_uses_check check (max_uses >= 1);
--   grant insert on public.invites to authenticated;
--   create policy "invites_insert_own" on public.invites for insert
--     to authenticated with check (owner_id = auth.uid());
--   -- (generate-invite must also revert to inserting under the caller's JWT client.)
-- ----------------------------------------------------------------------------

-- 1. Remove the direct insert path for app roles. select + update grants are left untouched.
revoke insert on public.invites from authenticated;
drop policy if exists "invites_insert_own" on public.invites;

-- 2. Bound what any path (owner included) may create. Replace the original `max_uses >= 1` inline
--    check with a two-sided bound, and require an expiry.
alter table public.invites drop constraint if exists invites_max_uses_check;
alter table public.invites
  add constraint invites_max_uses_bounded check (max_uses between 1 and 50);
alter table public.invites
  add constraint invites_expires_at_required check (expires_at is not null);
