# daily-state

`daily_state` data access (TanStack Query). One row per `(user_id, local-date)`.

- **`use-daily-state.ts`**
  - `useDailyState(timeZone)` — reads today's completion maps (`done`, `done_at`,
    `habit_done`, `subtask_done`). The query key includes the user-local date
    (`localDateInTZ(timeZone)`), so crossing local midnight refetches a fresh (empty) day.
  - **No row is the normal empty state**, not an error: the row is created lazily by the
    first mark-done (a mutation added in a later PR), so a missing row returns empty maps.

Read-only here. Mutation hooks (mark done/undone, habits, subtasks) come in a later Stage 3 PR.
