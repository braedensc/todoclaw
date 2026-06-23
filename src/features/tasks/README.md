# tasks

Task data access. TanStack Query owns the server state; the Supabase client is the only
transport. (Task UI now lives in the per-view feature folders — `grid`, `list`, `done`.)

- **`use-tasks.ts`**
  - `useTasks()` — query for the signed-in user's **live** tasks (`deleted_at is null`,
    newest first). Rows are validated through `TaskSchema` (`src/types/task.ts`).
  - `useAddTask()` — insert mutation. Seeds new tasks at grid center (`x: 0.5, y: 0.5`) so
    they have non-null coordinates (the priority score is NaN otherwise). **The client never
    sends `user_id`** — the column defaults to `auth.uid()` and RLS `WITH CHECK` enforces
    ownership server-side.
  - `useUpdateTask()` — generic single-task patch (`{ id, patch }`) over `x`/`y`/`text`/
    `due`/`staged`/`recurring`. The shared write path for grid drag, list sliders, and inline
    edit in later feature PRs.
  - `useSoftDeleteTask()` — sets `deleted_at`. **This is the only "delete".** The migration
    grants no `DELETE` and defines no `DELETE` policy, so a hard delete from the client is
    structurally impossible — the strongest guard against accidental loss.

## Out of scope here (later stages)

- Grid placement UI, quadrants, clustering, list-view sliders — later Stage 3 PRs.
- Realtime subscriptions — fetch + invalidate only for now.
