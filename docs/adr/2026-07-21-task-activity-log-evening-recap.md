# ADR 2026-07-21 — Task activity log + AI-written evening recap

**Date:** 2026-07-21 · **Post-launch** (BabyClaw proactive messaging) · **Status:** Accepted

The evening check-in (ADR-0031) only knew about **plan-item completions**, and even those were
inferred. The app stores each task's *current* state, never what *changed*, so nothing could
distinguish "moved the novel to an ongoing project today" from "it was always ongoing." We wanted
the evening message to be a warm, conversational recap of **everything the user did to their tasks
that day** (completed, deleted, created, moved between quadrants, re-dated, paused, renamed, made
recurring/ongoing) plus a gentle look-ahead — and for BabyClaw to answer "what did I do today?" in
live chat. The blocker was purely data: there was no record of actions.

## Decision 1 — capture actions with a DEFINER trigger on `tasks` (the one chokepoint)

There is **no create/update/delete RPC** for tasks — the client (`use-tasks.ts` `.update(patch)`)
and BabyClaw (`capabilities/tasks.ts` `updateTaskRow`) both write the `tasks` table **directly**
with generic patches; `set_task_done`/`set_task_undone`/`restore_backup` are the only task-writing
RPCs. So the single place every writer passes through is the table itself. A new
`log_task_activity()` trigger (`AFTER INSERT OR UPDATE ON public.tasks`, migration
`20260721120000`) classifies the action by **diffing OLD vs NEW** and inserts one semantic row into
a new `task_activity` table. Precedent: two `AFTER UPDATE ON public.tasks` triggers already run
(the `task_reminders` recompute).

**Why the trigger is `SECURITY DEFINER` (unlike those sibling `INVOKER` reminder triggers):**
`task_activity` has **no user insert/update/delete policy and no write grant** — the DEFINER trigger
is the *sole* writer (owners get `SELECT` only). A client therefore cannot forge or tamper with the
log — verified: a direct authenticated `INSERT` is rejected with "permission denied." Classification
is one row per statement via a priority-ordered `CASE` (completion/delete first, then type changes,
due, pause, rename, placement, then a quadrant-crossing move — sub-quadrant drag nudges log nothing).
The grid's mid-drag + final-drop double-write collapses to a single `placed` via a short
positioning-family window. `restore_backup` sets a txn-local `todoclaw.suppress_activity` GUC the
trigger honors, so a bulk restore doesn't flood the log.

## Decision 2 — a new proactive AI call (`generateRecap`), reusing the `plan_my_day` budget

The evening recap is now AI-written, mirroring Plan My Day exactly: the dispatcher claims a
deterministic body first (idempotent), then budget-gates an AI enrichment (`run-recap.ts
generateRecap`, forced `emit_recap` tool use) and `enrich_message`s the body; on a paused budget or
any failure the deterministic `buildRecapMessage` stands. It reuses the **`plan_my_day`** budget/rate
ledger rather than a new feature key — the per-day message claim already bounds it to one recap per
user per day (≤ 1 plan + 1 recap/user/day). A dedicated `evening_recap` feature with its own limits
is a clean follow-up if separate tuning is ever wanted. The recap persona lives entirely in the
prompt (warm dog-companion, ≤120 words, only-listed-items, look-ahead, one flourish); it references
today's activity + the plan's done/open split + a due-date/recurring look-ahead bundle.

## Decision 3 — plaintext content copy; out of backups, like `history`/`daily_state`

`task_activity.task_text` is a plaintext title snapshot — the **same class as `history.text`**
(no column encryption exists anywhere in the app; ADR-0030 endorses plaintext for low-stakes planner
data), so it introduces **no new encryption obligation**. Like `history` and `daily_state`, the
table stays **out of `create_backup`/`restore_backup` and the external encrypted `pg_dump`** (it's
AI/telemetry meta, not planner content the user restores). Retention is **newest-500 rows per user**,
pruned in the trigger via DELETE-not-in-newest-N (the `create_backup` pattern) — never a raise-on-cap
(that would abort the user's task write).

## Consequences

- BabyClaw's chat context gains a `TODAY'S ACTIVITY` DATA block (bucketed to the user's local day),
  so "what did I do today?" works mid-day, not just in the evening push.
- Every future task-reading surface that wants "what changed" reads `task_activity`; every writer is
  captured automatically (no per-call-site instrumentation to keep in sync).
- The proactive dispatcher now makes up to two AI calls per user per day (morning plan + evening
  recap), both under the same global budget kill-switch and per-user caps.
- Down path is in the migration header (drop the table/trigger/RPCs; re-create `restore_backup`
  without the suppression line).
