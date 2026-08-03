# ADR-0007 — Stage 2 schema: habits, daily_state, user_schedule (+ RLS, shared Zod types)

**Date:** 2026-06-23 · **Stage:** 2 (PR #1) · **Status:** Accepted

The remaining tables from the master-plan schema, each **replicating the proven `tasks`
pattern** (ADR-0005): RLS enabled; the only policies are owner-scoped (`user_id = auth.uid()`
in `USING` + `WITH CHECK`) and only for `authenticated`; `user_id` defaults to `auth.uid()`;
`grant select, insert, update` only — **no DELETE grant or policy**. Three migrations, one per
table, in PR #1.

- **`habits`** — soft-delete (`deleted_at`) like `tasks`; `subtasks` is an **embedded ordered
  jsonb array** of `{id,text}`, not a child table. Subtasks have no independent identity, are
  always loaded with the habit, and EisenClaw stored them inline — a jsonb array keeps that
  1:1 fidelity without a join. Index `(user_id) where deleted_at is null`.
- **`daily_state`** — **one row per `(user_id, date)`** (PK), not a single mutable
  current-state row. This makes the daily reset **non-destructive by construction**: "today" is
  just the row for today's date; yesterday's row persists. There is deliberately **no
  `lastReset` column** — the row's existence is the reset signal, so the stale-comparison race
  the original had (EISENCLAW-LOGIC-TO-PORT.md §10) cannot recur. `date` is the user's **local**
  calendar day (never `current_date`, which is server-UTC) — computed via the helper below;
  no DB default, to force a timezone-correct value. Columns `done`/`done_at`/`habit_done`/
  `subtask_done` are jsonb maps; `subtask_done` is keyed by the composite `"habitId:subtaskId"`.
  No soft-delete (the rows *are* the historical record).
- **`user_schedule`** — one row per user (PK `user_id`). **`timezone` is hoisted to a top-level
  `text not null default 'UTC'` column** (with a `length(btrim(...)) > 0` CHECK) because it is
  load-bearing for the timezone-correct daily reset and deserves a NOT NULL guarantee + cheap
  read — not a jsonb extract. The rest (`location`/`weekday`/`weekend`/`running`, the Plan My
  Day context) stays in `config` jsonb. This **deviates from the master plan's `config`-only
  shape** for that correctness reason. An `updated_at` trigger (`public.set_updated_at()`,
  reusable) keeps the row's mtime fresh.

**Shared Zod types (the "Zod = TS type" deliverable).** `src/types/{habit,daily-state,
user-schedule}.ts` mirror each table and double as parse guards at the Supabase boundary.
`tasks.bucket` tightened to `z.literal('oneoff').nullable()` (only `oneoff` exists —
Discrepancy #8; nullable because Stage 1 rows carry no bucket). `tasks.recurring` and
`user_schedule.config` are **left loose** — tightening a shape no code produces yet is
dead-spec risk; they are modeled by the stages that consume them (recurring → Stage 3,
config → the AI stage).

**Deliberately deferred (additive, no dead code now):**
- The permanent **`history` table** (denormalized Done-tab log with conditional restore) →
  **Stage 3**, with the Done feature. The master schema lists no history table; it is purely
  additive.
- Per-table **TanStack hooks** (`useHabits`/`useDailyState`/`useUserSchedule`) → **Stage 3**,
  when UI consumes them. Building them now would be untested-by-UI dead code.
- Default **`user_schedule` row** creation → **app-side upsert on first authenticated load**
  (the `use-tasks` insert pattern: client omits `user_id`, the DB default + RLS assign it),
  **not** a trigger on `auth.users`. A `SECURITY DEFINER` trigger that errors inside the signup
  transaction breaks signup entirely with an opaque error — a documented Supabase footgun.

**Timezone helper.** `src/lib/dates.ts` `localDateInTZ(timeZone, instant?)` → `YYYY-MM-DD` via
`Intl.DateTimeFormat(...).formatToParts` (locale-deterministic). This is the canonical "today
in the user's timezone" used to pick the `daily_state.date` row, directly retiring Discrepancy
#3. Seed-tested in PR #2.

**Note — platform-default grants.** Supabase's `postgres`-role default privileges
(`pg_default_acl`) auto-grant `TRUNCATE, REFERENCES, TRIGGER` to `anon`/`authenticated` on every
new `public` table. These appear on the new tables exactly as they already do on the
reviewed `tasks` table, and are **not reachable through PostgREST** (no TRUNCATE endpoint; the
roles are NOLOGIN). Left as-is for consistency with the shipped baseline; a uniform
`revoke TRUNCATE/REFERENCES/TRIGGER` across all app tables is a possible future hardening, not
a per-table divergence snuck in here.

**Verified.** `supabase db reset` applies all three cleanly; a two-user JWT proof (one
rolled-back transaction simulating two `authenticated` sessions) confirmed for every new table:
cross-user reads/writes blocked, `WITH CHECK` blocks forging `user_id`, hard `DELETE` is
permission-denied, `habits` soft-delete is recoverable, `daily_state` `(user_id,date)` isolation
holds with no PK clash across users, and the blank-`timezone` CHECK fires.
