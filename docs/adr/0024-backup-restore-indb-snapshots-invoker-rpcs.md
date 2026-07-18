# ADR-0024 — Backup/restore: in-DB snapshots + INVOKER RPCs + JSON export (Stage 5 PR3)

**Date:** 2026-07-02 · **Stage:** 5 (PR3) · **Status:** Accepted

The last Stage 5 polish item: backup & restore. Braeden chose in-DB snapshots over a
client-file-only scheme (portability escape hatch kept as a JSON export). Decisions:

- **`public.backups` snapshot table + two SECURITY INVOKER RPCs** (migration
  `20260702000000_backups.sql`). `create_backup(label)` snapshots the caller's own live tasks +
  habits + schedule into a `data` jsonb blob (server-side read — authoritative, not client-trusted)
  and prunes to the newest **10** (`MAX_BACKUPS`, EisenClaw parity, srv:31). `restore_backup(id)`
  applies a snapshot. Both are INVOKER (matching the Stage 3 merge-RPCs, ADR-0013): they run as the
  caller, RLS applies, `user_id` is always `auth.uid()` and never a parameter — a caller cannot
  touch another user's rows. No service-role client anywhere.
- **Restore = a CONTENT restore, reconciled with the data-safety invariants.** In one transaction it
  upserts the snapshot's tasks/habits (clearing `deleted_at` so a since-deleted item returns),
  **soft-deletes** live rows *not* in the snapshot (an UPDATE — reusing the existing insert/update
  grants; **no delete grant needed**, honoring ADR-0005), and restores `user_schedule`. It
  **deliberately does not touch `history` or `daily_state`** — your completion log is append-only
  (ADR-0012) and today's checkmarks are ephemeral, so a restore rewinds *content*, not your history.
  This is the only ADR-compliant reading of "restore", and it's the same denormalized-snapshot
  philosophy as ADR-0012.
- **`backups` grants `select/insert/delete` (owner-scoped); no UPDATE.** DELETE exists ONLY so
  `create_backup` can prune the user's *own* snapshots — a narrow, documented departure from
  ADR-0005's no-delete stance, which protects *primary* data. Backups are recoverable meta, RLS
  scopes them to the owner, and a snapshot is immutable (no update path).
- **Client JSON export, no import.** A "Download JSON" button serializes the current tasks + habits
  to a file (`export-json.ts`, pure `buildPlannerExport` + browser `downloadJson`). Export only —
  recovery is via the in-app snapshots, so there is no untrusted-file import surface.

**Verified.** `supabase migration up` applies the migration cleanly on the local stack; a
rolled-back psql proof exercised the RPCs end-to-end (snapshot → mutate → restore: a
soft-deleted-then-snapshotted task comes back live, a post-snapshot task is soft-deleted, and the
`history` row is untouched). 13 frontend unit tests (export build/filename + panel create/restore/
confirm) + typecheck/lint/format green. A `backups.golden.spec.ts` round-trip covers the UI against
the real stack (local, sequenced golden run — shares the one test user).

**Merge note.** Renumbered to **ADR-0024** after Stage 6's PR #43 (0022, CI deploy) and PR #47
(0023, production cutover) landed 0022/0023 on main first; this PR merged origin/main and appended
its ADR at the tail. The migration is additive (a new table + two functions) and deploys to prod via
the ADR-0022 CI pipeline on merge.
