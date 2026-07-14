# backups

Backup & restore of the user's planner content (Stage 5, PR3). Two ways to save your data:

1. **In-DB snapshots** — server-side point-in-time copies of your tasks + habits + schedule,
   created/restored via RPCs. This is the in-app restore.
2. **JSON export** — a client-side download of your current content, for portability/offline.

## Files

- **`BackupsPanel.tsx`** — lives in **Settings → Backups** (2026-07-14; `embedded` renders just the
  content there — no chrome of its own). Lists snapshots newest-first with **Create backup** /
  **Restore** (restore behind a `window.confirm`), plus a **Download JSON** button. The standalone
  modal/sheet form is retained for any direct use + its test.
- **`use-backups.ts`** — TanStack hooks: `useBackups` (list), `useCreateBackup`, `useRestoreBackup`.
  Create/restore are `supabase.rpc(...)` calls; restore invalidates `tasks`/`habits`/`user_schedule`.
- **`export-json.ts`** — `buildPlannerExport` (pure, tested) + `downloadJson` (browser glue) +
  `exportFilename`. Export only — there is intentionally **no import** (avoids an untrusted-file
  surface; the in-app restore covers recovery).

## Server side (migration `20260702000000_backups.sql`)

- **`public.backups`** — owner-scoped snapshot rows; `data` jsonb holds the copy. RLS + grants
  `select/insert/delete` (DELETE only to prune your own snapshots — a narrow, documented departure
  from ADR-0005, which protects *primary* data). No UPDATE — a snapshot is immutable.
- **`create_backup(label)`** (SECURITY INVOKER) — snapshots the caller's own live tasks + habits +
  schedule and prunes to the newest **10** (`MAX_BACKUPS`, EisenClaw parity).
- **`restore_backup(id)`** (SECURITY INVOKER) — a **content restore**, in one transaction: upsert
  the snapshot's tasks/habits (un-deleting them), **soft-delete** live rows not in the snapshot
  (an UPDATE — no delete grant needed), and restore the schedule.

## Restore semantics (reconciled with the data-safety invariants)

- **No hard deletes (ADR-0005):** items added after the snapshot are **soft-deleted** (recoverable),
  never destroyed.
- **History is permanent (ADR-0012):** restore **never touches** `history` or today's `daily_state`.
  It rewinds your tasks/habits/schedule — not your completion log or today's checkmarks.

`user_id` is always `auth.uid()` server-side (never a client parameter); RLS scopes every row and
RPC to the owner. Verified by a rolled-back psql proof (upsert-brings-back, keep, soft-delete of
post-snapshot items, history untouched) and a golden E2E round-trip.
