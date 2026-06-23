# tasks

Task data access for the Stage 1 skeleton. TanStack Query owns the server state; the
Supabase client is the only transport.

- **`use-tasks.ts`**
  - `useTasks()` — query for the signed-in user's **live** tasks (`deleted_at is null`,
    newest first). Rows are validated through `TaskSchema` (`src/types/task.ts`).
  - `useAddTask()` — insert mutation. **The client never sends `user_id`** — the column
    defaults to `auth.uid()` and RLS `WITH CHECK` enforces ownership server-side.
  - `useSoftDeleteTask()` — sets `deleted_at`. **This is the only "delete".** The
    migration grants no `DELETE` and defines no `DELETE` policy, so a hard delete from
    the client is structurally impossible — the strongest guard against accidental loss.
- **`TaskList.tsx`** — the skeleton UI: add input, live list, per-row soft-delete.

## Out of scope here (later stages)

- Grid placement (`x`/`y`), quadrants, clustering, list-view sliders — Stage 3.
- Realtime subscriptions — Stage 1 is fetch + invalidate only.
