-- Migration: client_execute_grants_explicit
--
-- Intent: make the client-role EXECUTE surface in schema public explicit, so it no longer depends
-- on whatever Supabase's default ACL happens to grant.
--
-- WHAT BROKE. Every server-only RPC in this project is fenced with the same idiom:
--
--     revoke all on function public.f(...) from public;
--     grant execute on function public.f(...) to service_role;
--
-- That is only a fence if the client roles hold their EXECUTE *through* PUBLIC. Up to
-- supabase/postgres 17.6.1.136 they did — the postgres default ACL for functions in `public` was
-- `{postgres=X/postgres}`, i.e. PUBLIC revoked and no per-role grant, so `revoke … from public`
-- left anon/authenticated with nothing. As of 17.6.1.165 that default ACL is
-- `{postgres=X, anon=X, authenticated=X, service_role=X}`: every function a migration creates is
-- born with an EXPLICIT per-role grant to anon and authenticated, and `revoke … from public`
-- cannot remove an explicit per-role grant. The fence stopped fencing, silently, with no change
-- on our side.
--
-- The blast radius is not the two functions CI happened to assert on. On a stack built with the
-- new image, 69 of 70 functions in `public` were reachable by anon and/or authenticated, including
-- every `*_for_user(uuid, …)` RPC — dispatch_inputs_for_user, memories_for_user,
-- push_subscriptions_for_user, save_daily_plan_for_user, task_activity_for_user, claim_message,
-- insert_reminder_message, mint_invite. Those take the target user_id as an ARGUMENT (they are
-- called by edge functions holding service_role, after the function has verified the caller), so a
-- grant to anon is a full cross-tenant read/write hole, not a theoretical one.
--
-- THE FIX, in three parts, all idempotent:
--   1. Stop the bleeding at the source — take EXECUTE out of the default ACL, so a function created
--      by a future migration is born with NO client-role grant regardless of the image's defaults.
--   2. Reset the existing surface — blanket-revoke EXECUTE from anon/authenticated/public across
--      schema public.
--   3. Re-grant, by explicit signature, exactly the functions the app intends clients to call.
--
-- Part 3 is a RESTATEMENT, not a change: the 21 signatures below are precisely the net EXECUTE
-- grants the migration history already expresses, and precisely the set a pre-17.6.1.165 stack ends
-- up with (verified by diffing pg_proc.proacl on both images against a scan of supabase/migrations
-- — the old image is 0-over-granted, the new one is 69). No caller gains or loses a privilege it
-- had on a correctly-built stack; the DB simply now says so out loud instead of inheriting it.
--
-- Kept in lockstep with CLIENT_CALLABLE_FUNCTIONS in scripts/check-rls-live.mjs, which asserts the
-- live ACLs equal this set on every PR (check I) — so the next image that changes a default cannot
-- reopen this quietly.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the implicit, image-dependent behavior):
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
--   grant execute on all functions in schema public to anon, authenticated;
--   -- (do NOT do this: it is the hole. Reverting means reverting the whole migration.)
-- ----------------------------------------------------------------------------

-- ── 1. Prospective: a new function must not be born client-callable ─────────────────────────────
-- Applies to the default ACL of the role running migrations (postgres), which is the role that
-- creates every function in supabase/migrations. Supabase's own `supabase_admin` default ACL is
-- left alone deliberately — it governs platform-created objects (storage, graphql), not ours.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── 2. Retroactive: clear the whole client-role surface ─────────────────────────────────────────
-- Blanket, so it repairs a database built under EITHER default ACL and needs no per-function
-- knowledge of which image minted it. All 70 functions in `public` are owned by postgres (no
-- extension installs into this schema), so nothing here is someone else's object to revoke on.
revoke execute on all functions in schema public from public, anon, authenticated;

-- ── 3. Re-grant the intended client surface ─────────────────────────────────────────────────────
-- Grouped by caller. Signatures are spelled in full because overloads exist (ai_budget_add,
-- ai_usage_record_tokens, due_task_reminders) and only the live overload should be granted.

-- Called from the browser with the user's own JWT (src/**/*.ts `supabase.rpc(...)`).
grant execute on function public.set_task_done(date, uuid, text, text) to authenticated;
grant execute on function public.set_task_undone(date, uuid) to authenticated;
grant execute on function public.set_daily_flag(date, text, text, boolean) to authenticated;
grant execute on function public.log_task_work(uuid, date, boolean) to authenticated;
grant execute on function public.save_daily_plan(date, jsonb) to authenticated;
grant execute on function public.set_task_reminder(uuid, int) to authenticated;
grant execute on function public.remove_task_reminder(uuid, int) to authenticated;
grant execute on function public.clear_task_reminder(uuid) to authenticated;
grant execute on function public.mark_message_read(uuid) to authenticated;
grant execute on function public.chat_list_previews(int) to authenticated;
grant execute on function public.chat_open_for_message(uuid) to authenticated;
grant execute on function public.create_backup(text) to authenticated;
grant execute on function public.restore_backup(uuid) to authenticated;

-- Called from an edge function on the CALLER's client (the user's JWT is forwarded), so these are
-- executed as `authenticated` and every one is fenced to auth.uid() inside — see
-- DEFINER_GRANT_ALLOWLIST in scripts/check-definer-grants.mjs for each one's scoping verdict.
grant execute on function public.ai_usage_check_and_record(text, integer, integer) to authenticated;
grant execute on function public.ai_usage_record_tokens(uuid, integer, integer, integer, integer) to authenticated;
grant execute on function public.ai_budget_check(bigint) to authenticated;
grant execute on function public.ai_budget_add(uuid, bigint) to authenticated;
grant execute on function public.ai_user_budget_check(bigint) to authenticated;
grant execute on function public.ai_active_user_count(text) to authenticated;
grant execute on function public.app_config_get() to authenticated;

-- Pre-auth IP throttle: anon too, because the edge functions it guards run verify_jwt=false (#311).
grant execute on function public.edge_ip_throttle(text, text, integer, integer) to anon, authenticated;
