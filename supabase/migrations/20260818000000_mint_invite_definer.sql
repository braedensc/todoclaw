-- Migration: mint_invite_definer
--
-- Intent: make invite minting work again. 20260713020000_invites_owner_only_mint revoked the
-- authenticated INSERT path on public.invites and moved generate-invite's insert to the
-- service-role admin client — but in this project service_role holds NO table DML (the default
-- ACL hands it only TRUNCATE/REFERENCES/TRIGGER; that is exactly why every other server write
-- goes through SECURITY DEFINER RPCs — claim_message, insert_reminder_message, the chat
-- transcript writes). So the L3 fix removed the ONLY working insert path: every mint since
-- 2026-07-13 has failed with 42501 "permission denied for table invites" (surfaced to the owner
-- as `insert_failed` since #358). Verified against prod: service_role's privileges on invites
-- are {TRUNCATE, REFERENCES, TRIGGER}, and a service-role INSERT raises 42501.
--
-- Fix: complete the claim/release/record family with the missing piece — mint_invite, a
-- SECURITY DEFINER insert fenced to service_role ONLY (revoked from public), reachable solely
-- through generate-invite's admin client. The owner gate stays where it has always been:
-- generate-invite's isOwner() check sets p_owner_id to the verified caller (same trust shape as
-- claim_invite_code, which also trusts its Edge Function caller). The table CHECKs added by
-- 20260713020000 (max_uses between 1 and 50, expires_at not null) still bound what ANY caller —
-- this function included — can create; unique(code) still applies.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.mint_invite(uuid, text, integer, timestamptz);
--   -- (generate-invite must then insert some other way — as of this migration there is none.)
-- ----------------------------------------------------------------------------

-- Insert one invite row on behalf of the isOwner()-verified caller and return the fields the
-- Edge Function echoes to the owner. Runs as the function owner (postgres), so it needs no
-- table grant for service_role; the CHECK constraints and unique(code) still enforce inside.
create or replace function public.mint_invite(
  p_owner_id   uuid,
  p_code       text,
  p_max_uses   integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invites;
begin
  insert into public.invites (owner_id, code, max_uses, expires_at)
  values (p_owner_id, p_code, p_max_uses, p_expires_at)
  returning * into v_row;
  return jsonb_build_object(
    'code', v_row.code,
    'max_uses', v_row.max_uses,
    'expires_at', v_row.expires_at
  );
end;
$$;

-- Fence: service_role ONLY (revoke from public, which includes anon + authenticated) — the same
-- fencing as claim_invite_code / release_invite_claim / record_invite_redemption / invite_throttle.
revoke all on function public.mint_invite(uuid, text, integer, timestamptz) from public;
grant execute on function public.mint_invite(uuid, text, integer, timestamptz) to service_role;
