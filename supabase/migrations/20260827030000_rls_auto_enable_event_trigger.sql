-- Migration: rls_auto_enable_event_trigger
--
-- Intent: check IN a safety net that has been running in PRODUCTION for months but was never in
-- version control. Prod carries a `postgres`-owned event trigger `ensure_rls` on `ddl_command_end`
-- whose function `public.rls_auto_enable()` enables Row Level Security on every table created in
-- `public`. It was created out-of-band (dashboard SQL editor / a manual psql session) and
-- `grep -rn rls_auto_enable supabase/` returned nothing, so a from-scratch `supabase db reset`
-- produced a database WITHOUT it. Measured 2026-08-27: 71 postgres-owned `public` functions on prod
-- vs 70 from a clean local build, reproduced on two local images (17.6.1.136 and 17.6.1.165) — so
-- this is not image-dependent, it is genuine out-of-band drift. Found while diagnosing the postgres
-- 17.6.1.165 default-ACL drift (#411).
--
-- Why check it in rather than drop it from prod: it is a LIVE defense-in-depth backstop, and the
-- divergence is itself the bug — local/CI was not a faithful rebuild of production. The body below
-- is reproduced VERBATIM from prod's `pg_get_functiondef()` so the two converge exactly.
--
-- What this is NOT: it is not the reason the RLS guards pass. `scripts/check-rls.mjs` is a static
-- scan that requires an explicit `enable row level security` in the migration TEXT (23/23 public
-- tables have one), and `scripts/check-rls-live.mjs` runs against a LOCAL stack that never had this
-- trigger. Both passed on their own merits while this was absent. This is a second line of defense
-- for the paths migrations do not cover — a table created through the dashboard, or a migration
-- whose RLS statement the static regex fails to match — never the primary guarantee.
--
-- Idempotent by construction: `create or replace` for the function, and the event trigger is created
-- only when absent (Postgres has no `create event trigger if not exists`). On prod both already
-- exist, so this migration is a no-op there. Note `postgres` is NOT a superuser on the managed
-- project (`rolsuper` = false) even though it owns the existing trigger, so the create is wrapped to
-- degrade to a WARNING on `insufficient_privilege` rather than break a from-scratch managed deploy;
-- only that one condition is caught, never a blanket swallow.
--
-- Interaction to know about: with this trigger active, EVERY new `public` table gets RLS on. The one
-- place that deliberately wants a table WITHOUT RLS is the positive control in
-- `scripts/check-rls-live.mjs` (`_rls_probe_open`, which must be readable or the anon probe is
-- vacuous). That script now disables RLS on it explicitly — see the comment there.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop event trigger if exists ensure_rls;
--   drop function if exists public.rls_auto_enable();
--   -- Dropping this removes only the backstop; the explicit `enable row level security` in each
--   -- migration (enforced by scripts/check-rls.mjs) remains the primary guarantee.
-- ----------------------------------------------------------------------------

create or replace function public.rls_auto_enable()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Attach the trigger only when it is not already there. Prod already has it (owner `postgres`), so
-- this branch never runs against prod and no privilege is exercised there.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
exception
  when insufficient_privilege then
    -- Creating an event trigger normally requires superuser. A local/CI stack runs as one; a managed
    -- project's `postgres` may not. Warn loudly instead of failing the deploy — the static and live
    -- RLS guards are the primary enforcement and are unaffected.
    raise warning 'rls_auto_enable: could not create event trigger ensure_rls (insufficient privilege); RLS backstop not installed. The check-rls guards still enforce explicit RLS.';
end $$;
