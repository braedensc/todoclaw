# schedule

`user_schedule` data access (TanStack Query). There is at most one row per user.

- **`use-user-schedule.ts`**
  - `useUserSchedule()` — query for the signed-in user's schedule row (or `null` if none
    yet). Validated through `UserScheduleSchema` (`src/types/user-schedule.ts`).
  - `useEnsureUserSchedule()` — idempotent upsert (`onConflict: 'user_id'`,
    `ignoreDuplicates`) that seeds a default row on first authenticated load. The client
    never sets `user_id` (DB default `auth.uid()`); `timezone` comes from the browser's
    resolved IANA zone, `config` starts empty. The daily reset depends on `timezone`, so
    App wires this into a mount effect to guarantee the row exists.
