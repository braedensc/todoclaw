# ADR-0005 — No client hard-delete: soft-delete + RLS deny-by-default

**Date:** 2026-06-23 · **Stage:** 1 (PR #2) · **Status:** Accepted

`tasks` carries `deleted_at`; the app only ever soft-deletes (an `UPDATE`). The migration
grants `authenticated` **`select, insert, update` — never `delete`** — and defines **no DELETE
policy**, so a hard delete from the client is structurally impossible (doubly: no grant *and*
no policy). RLS is deny-by-default, scoped `to authenticated`, gated on `user_id = auth.uid()`
for both `USING` and `WITH CHECK`, so a client can neither read others' rows nor forge
ownership.

- **Why:** directly serves the "no accidental data loss / no escalation" requirement. Recovery
  doesn't depend on backups for the common case — deleted data is still a live row.
- The service-role key bypasses RLS for admin/backup needs but is never used by app code.
- Verified with a psql two-user proof and a supabase-js e2e (isolation, escalation blocked,
  hard-delete denied, soft-delete recoverable).
