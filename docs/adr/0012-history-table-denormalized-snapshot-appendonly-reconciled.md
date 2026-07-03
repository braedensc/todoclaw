# ADR-0012 — `history` table: denormalized snapshot + append-only (reconciled with soft-delete)

**Date:** 2026-06-24 · **Stage:** 3 (PR6)

The Done tab is backed by a dedicated `public.history` table — the permanent completion log —
**not** a view over `tasks`/`daily_state`. Three coupled decisions:

- **Denormalized snapshot.** Each row carries its own `text` and `bucket`, captured at
  completion time, and a `task_id` that is **nullable with NO foreign key**. The snapshot is
  the source of truth. This is the deliberate reconciliation with ADR-0005's soft-delete-only
  model: deleting a completed task from the Done tab **soft-deletes the task** (`useSoftDeleteTask`)
  while the history row survives intact. A FK + `on delete cascade` would have erased history on
  delete; a FK without cascade would have blocked it. No FK at all means the log is independent
  of the task's lifecycle — exactly what a permanent record needs.
- **Append-only / immutable.** The grant is **SELECT + INSERT only** — no UPDATE, no DELETE, and
  no update/delete RLS policy. Once a completion is written it cannot be mutated or removed by the
  app. "Restore" does not delete a history row (it only flips today's `daily_state.done`); "delete
  from the Done tab" targets the task, never the row. So there is no client path that rewrites the
  log. (This is a behaviour change from EisenClaw, whose `×` removed the entry from history — we
  keep the permanent record instead and re-point `×` at the task.)
- **`task_id` retained for restore-eligibility only.** Restore is offered (`canRestore`) only while
  the completion is still in **today's** `daily_state.done` map — checked by `task_id`. A row from
  a previous day, or whose task is gone, simply shows no Restore button. RLS owner-scopes the table
  (`user_id = auth.uid()`); the index `(user_id, completed_at desc)` serves the newest-first read.
