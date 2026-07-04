# EisenClaw seed import

Dev-only convenience: loads Braeden's real EisenClaw planner data (tasks, habits, one history
entry, schedule config — `planning/eisenclaw-export/data/`, gitignored reference material) into
a **local** Supabase instance, for manual UI testing against familiar, realistic data instead of
an empty account.

This is a personal dev/test convenience, not a product feature — the app's own seed is empty by
design (no auto-seeding onto real signup/onboarding; see CLAUDE.md Hard Rule 6 and
`planning/eisenclaw-export/docs/todoclaw.md`: "Seed is empty ... auto-seeding is disabled").

## Layout

- `types.ts` — the old flat-JSON shapes (task/habit/history/schedule), read-only description of
  `planning/` data; nothing from `planning/` is copied into this tree.
- `map.ts` — pure functions mapping old shapes onto the current schema. Flags every field that
  doesn't map 1:1 (non-`oneoff` buckets, missing `recurring.doneCount`, missing `createdAt`) as a
  `MapWarning` rather than silently dropping it.
- `source.ts` — locates and reads the planning data. `planning/` is gitignored, so a fresh git
  worktree checkout won't have it even though the main checkout does — this falls back to the
  main worktree (via `git worktree list`) and errors with a clear message if neither has it.
  Override with `EISENCLAW_SEED_DIR` to point at a copy elsewhere.
- `ids.ts` — deterministic (hash-derived) ids keyed on `userId:oldId`, so the same old EisenClaw
  id always maps to the same row — both here and in every historical `backups/*.json` snapshot.
  That consistency is what makes `restore_backup` (which upserts by `id`) update the SAME
  task/habit row across snapshots instead of duplicating it.
- `insert.ts` — the actual INSERTs, shared by both the CLI below and the e2e fixture helper
  (`e2e/helpers/db.ts` → `seedEisenclawFixtures`).
- `import.ts` — the CLI entrypoint.

## Usage

```bash
supabase start                                          # local stack must be running
npm run seed:eisenclaw -- --email you@example.com        # tasks + habits + history + schedule
npm run seed:eisenclaw -- --email you@example.com --with-backups   # + the 10 historical snapshots
```

Run with no `--email` to list the local users found (`auth.users`) — the app is sign-in-only, so
create a user first via Studio (`docs/SETUP.md` → "Create a local user in Studio").

**Local-only, structurally.** The script resolves its DB connection via
`e2e/helpers/env.ts#resolveLocalSupabaseEnv`, which shells out to `supabase status` — there is no
flag or code path that accepts a remote connection string.

Prints a summary of any fields that didn't map 1:1 onto the current schema (see `map.ts` above)
so nothing is dropped silently.
