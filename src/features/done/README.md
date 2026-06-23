# done

Done tab + the Done data layer (history table + atomic `daily_state` merge RPCs).

## Files

- `DoneView.tsx` — the Done tab. Renders `useHistory()` newest-first. A row shows the task
  text + a formatted `completed_at`. **Restore** (`↩`) appears only while the completion is
  still in today's `daily_state.done` map (`canRestore`) and calls `useRestoreTask`.
  **Delete** (`×`) soft-deletes the *task* (`useSoftDeleteTask`) after a confirm — the
  history row PERSISTS (it is the permanent log).
- `use-history.ts`:
  - `useHistory()` — query `history` ordered `completed_at desc`, key `['history']`.
  - `useMarkTaskDone()` — calls the `set_task_done` RPC (atomic merge of today's
    `done`/`done_at` + the history insert, one transaction); invalidates `['history']` and
    `['daily_state', <today>]`. (Wired to grid/list "done" buttons in a later wave.)
  - `useRestoreTask()` — calls the `set_task_undone` RPC; invalidates only
    `['daily_state', <today>]` (history is append-only — never invalidated/removed).

## Data model

- **`history`** — denormalized, append-only permanent log. `text`/`bucket` are snapshots so
  rows survive a task soft-delete; `task_id` (nullable, no FK) only drives restore-eligibility.
  Grant is SELECT + INSERT only (no UPDATE/DELETE). See ADR-0012.
- **`daily_state` merge RPCs** — `SECURITY INVOKER` plpgsql that does an atomic
  `<map> || jsonb_build_object(key, val)` under the row lock, fixing the jsonb-clobber race.
  `user_id` is always `auth.uid()`, never a param. `set_daily_flag` covers `habit_done` /
  `subtask_done` for the later habits PR (no new migration needed). See ADR-0013.

Recurring tasks never write history (they reset `lastDoneAt` instead), so they never appear
here.
