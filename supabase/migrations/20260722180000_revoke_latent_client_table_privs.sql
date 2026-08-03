-- Migration: revoke_latent_client_table_privs
--
-- Intent: strip the RLS-immune table privileges Supabase's default ACL hands the client roles —
-- the "spare keys to a door users can't reach" observed in passing during #314.
--
-- The `postgres` default ACL for public tables grants anon/authenticated/service_role
-- TRUNCATE + REFERENCES + TRIGGER (+ MAINTAIN) on every table a migration creates, so all 21 app
-- tables carry them for anon AND authenticated today. None are reachable through the app's only
-- client channel (PostgREST exposes row DML + RPC, never TRUNCATE or DDL), so nothing is
-- exploitable — but none are gated by RLS either:
--
--   • TRUNCATE empties a table WHOLESALE — row-level security does not apply to it at all. It is
--     the one privilege where "RLS on every table" (the project's core defense) offers zero help.
--   • REFERENCES / TRIGGER are DDL-time abilities (point an FK at a table / attach a trigger);
--     client roles never run DDL.
--
-- Defense-in-depth rule: client roles hold only privileges the app actually uses and RLS can
-- gate. If a future change ever hands a client role a SQL path (a new extension, a DEFINER fn
-- with dynamic SQL, a platform feature), these must not be sitting there waiting.
--
-- Two-part fix, pinned by check-rls-live.mjs check G:
--   1. Revoke the three on every EXISTING public table for anon + authenticated.
--   2. Revoke them from the `postgres` default ACL so FUTURE tables stop minting them.
--
-- Deliberately untouched:
--   • service_role — server-only, trusted, never client-reachable (its key never ships).
--   • The 6 policy-gated DELETE grants (history ×, chat sessions, memories, push, …) — real app
--     features, RLS-scoped, correct.
--   • MAINTAIN (PG17 `m` bit) — same latent class but harmless (VACUUM/ANALYZE, no data access),
--     and `revoke maintain` is a syntax error on PG < 17: not worth a version-gated migration.
--   • The `supabase_admin` default ACL — on the hosted platform, migrations run as `postgres`,
--     which CANNOT alter supabase_admin's defaults (would abort the prod deploy — the #240
--     failure class). All project tables are created by postgres, so its ACL is the live one.
--   • Sequences — client roles get UPDATE on future public sequences by default, but the schema
--     has zero (uuid PKs throughout); revisit only if a sequence ever appears.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — restores the Supabase-default latent grants):
--   grant truncate, references, trigger on all tables in schema public to anon, authenticated;
--   alter default privileges for role postgres in schema public
--     grant truncate, references, trigger on tables to anon, authenticated;
-- ----------------------------------------------------------------------------

-- 1. Existing tables (all owned + originally granted by postgres, so postgres may revoke).
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- 2. Future tables: stop the default ACL from re-minting them on the next `create table`.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
