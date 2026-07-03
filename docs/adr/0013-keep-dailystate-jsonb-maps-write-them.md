# ADR-0013 — Keep `daily_state` jsonb maps; write them via atomic `SECURITY INVOKER` merge RPCs

**Date:** 2026-06-24 · **Stage:** 3 (PR6)

`daily_state` keeps its four jsonb maps (`done`/`done_at`/`habit_done`/`subtask_done`) on **one
row per (user, local day)** rather than normalizing completions into child rows. Writes go through
three plpgsql RPCs (`set_task_done`, `set_task_undone`, `set_daily_flag`) added in the same
migration.

- **Why keep the jsonb maps (don't normalize).** A normalized `daily_completion(user_id, date,
  kind, key, value)` table would trade the clobber problem for a join + per-toggle row churn and a
  second table to RLS, with no payoff: the maps are only ever read whole (the Done tab + habits
  read "what's checked today"), never queried by key across days. One row per day stays the simplest
  shape that matches the access pattern, and the non-destructive date-keyed reset (ADR-0007) already
  depends on it.
- **Why RPCs instead of client read-modify-write (the real fix).** With the maps on one shared row,
  a client that reads the row, edits a map in JS, and writes it back **races** any concurrent write
  to the same row — task-done racing a habit-check clobbers the other's edit (the jsonb-clobber
  hazard flagged in validation). The RPC does the merge server-side as
  `<map> = <map> || jsonb_build_object(key, val)` inside the `UPDATE`, so the merge is against the
  **current** row value under the row lock the `UPDATE` takes. Concurrent toggles to different keys
  both survive. `set_task_done` additionally folds the `history` INSERT into the **same
  transaction**, so there is never a done-without-history window. `.rpc()` is still the Supabase
  query builder, not raw SQL; plpgsql-in-migration is already precedent (`set_updated_at`).
- **Why `SECURITY INVOKER` (not DEFINER).** The functions run as the **caller**, so RLS still
  applies and `auth.uid()` is the real signed-in user. `user_id` is `auth.uid()` everywhere inside
  the function and is **never a parameter** — a caller cannot address another user's row. A
  `SECURITY DEFINER` function would run as the owner and bypass RLS; we explicitly do not want that.
  `search_path` is pinned to `public` as defence-in-depth. `set_daily_flag` whitelists its target
  map to `habit_done`/`subtask_done`, so the habits PR (PR9) reuses it with **no new migration**.
- **Realtime deferral (recorded here).** Realtime is deferred to Stage 5 (ADR/PR1 rationale: RLS
  scopes each user to their own rows, so Realtime only helps same-user-multi-device). The merge-RPC
  design makes adding it later purely additive — server-side atomic merges mean a future Realtime
  push reflects a consistent row, with no client-merge reconciliation to retrofit.
