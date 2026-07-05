# done

Done tab + the Done data layer (history table + atomic `daily_state` merge RPCs).

## Files

- `DoneView.tsx` — the Done tab (its own header + ✕ close live inside the parchment card;
  `DonePanel` is just the backdrop + focus management). Renders `useHistory()` newest-first as
  mini grid-cards: the row's left accent is the live task's quadrant color (from x/y), plus a
  recurring indicator and a due badge when the task has them. **Restore** (`↩`) appears for any
  completion whose task is still **live** (`canRestore` = the task is in `useTasks`) and calls
  `useRestoreTask` — it clears today's `done` flag so the task returns to the grid. **Delete**
  (`×`) removes THIS completion **record** from the list (`useDeleteHistoryEntry`) after a
  confirm; the task is untouched.
- `use-history.ts`:
  - `useHistory()` — query `history` ordered `completed_at desc`, key `['history']`.
  - `useMarkTaskDone()` — calls the `set_task_done` RPC (atomic merge of today's
    `done`/`done_at` + the history insert, one transaction); invalidates `['history']` and
    `['daily_state', <today>]`.
  - `useRestoreTask()` — calls the `set_task_undone` RPC; invalidates only
    `['daily_state', <today>]` (restore doesn't touch the history row).
  - `useDeleteHistoryEntry()` — `delete` on `history` by row id (owner-scoped RLS); invalidates
    `['history']`.

## Data model

- **`history`** — denormalized completion log. `text`/`bucket` are snapshots so rows survive a
  task soft-delete; `task_id` (nullable, no FK) drives restore-eligibility + the mini-card
  styling lookup. Owner-scoped SELECT / INSERT / DELETE, no UPDATE (a user may remove their own
  completions, but rows are never edited in place). See ADR-0012 (and its 2026-07-05 update:
  history was originally append-only; `×` now deletes the record).
- **`daily_state` merge RPCs** — `SECURITY INVOKER` plpgsql that does an atomic
  `<map> || jsonb_build_object(key, val)` under the row lock, fixing the jsonb-clobber race.
  `user_id` is always `auth.uid()`, never a param. `set_daily_flag` covers `habit_done` /
  `subtask_done` for the later habits PR (no new migration needed). See ADR-0013.

Recurring tasks never write history (they reset `lastDoneAt` instead), so they never appear
here.
