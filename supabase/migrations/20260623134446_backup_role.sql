-- Migration: backup_role
--
-- Intent: a least-privilege, READ-ONLY Postgres role for the automated backup job
-- (the GitHub Actions `pg_dump` in .github/workflows/backup.yml). It is deliberately
-- NOT the service-role / superuser — if its credential ever leaked, it could only
-- read `public`, never write or read auth secrets.
--
-- Scope: SELECT on the `public` schema only (the app/user data — `tasks`). The backup
-- workflow dumps `--schema=public`. Backing up the `auth`/`storage` schemas is a later
-- enhancement (those are Supabase-managed and need grants from their schema owners).
--
-- The role's PASSWORD is intentionally NOT set here — never commit a credential. After
-- this migration is applied to the CLOUD database, set it out-of-band (Supabase SQL
-- editor), then store the connection string as the GitHub Actions secret
-- BACKUP_DATABASE_URL (see docs/SERVICES.md):
--   alter role backup_ro with password '<generated-strong-password>';
--
-- Down path:
--   drop owned by backup_ro;
--   drop role backup_ro;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_ro') then
    create role backup_ro with login nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

grant connect on database postgres to backup_ro;
grant usage on schema public to backup_ro;
grant select on all tables in schema public to backup_ro;

-- Future tables in public are readable by the backup role too (without re-granting).
alter default privileges in schema public grant select on tables to backup_ro;
