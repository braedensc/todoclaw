# habits

Daily habits with expandable steps (subtasks). Parity ref:
`planning/eisenclaw-export/docs/eisenclaw.md` ("Daily Habits") + `pics/Todopic3.jpeg`.

## Model

A **habit** is its own row (`habits` table, `src/types/habit.ts`). Its **steps** are an embedded
jsonb `subtasks` array on that row — there is no separate subtasks table. The client never sends
`user_id` (DB default `auth.uid()` + RLS); "delete" is a soft delete (`deleted_at`), mirroring
tasks. Two display groups, by the `active` boolean:

- **Active** (`active === true`) — expandable rows with a daily checkbox + a steps panel.
- **Queued** (`active === false`) — dashed "activate" buttons; tap to flip `active` true.

## Daily completion (resets every local day, non-destructively)

Which habits/steps are checked **today** lives in `daily_state`, NOT on the habit row:

- `habit_done` — `{ habitId: true }`
- `subtask_done` — `{ "habitId:subtaskId": true }` (composite key — see `subtasks.ts` `subtaskKey`)

That split is what makes the reset non-destructive: `useDailyState(tz)` keys its query by the
user's **local** calendar day, so crossing local midnight just reads a different (empty) row —
the habit rows are untouched. Toggles go through the atomic merge RPC `set_daily_flag`
(`useToggleDailyFlag`), never a client read-modify-write, so concurrent toggles can't clobber
each other's jsonb edits.

## Files

- `use-habits.ts` — TanStack hooks: `useHabits`, `useAddHabit`, `useUpdateHabit` (active toggle /
  rename / subtasks edits), `useSoftDeleteHabit`, `useToggleDailyFlag`. Mirrors `use-tasks.ts`.
- `subtasks.ts` — pure helpers (`subtaskKey`, `appendSubtask`, `removeSubtask`); split out so the
  component test can mock the hooks without re-exporting this logic.
- `HabitsView.tsx` — the tab: reads `useHabits` + `useDailyState(tz)` + `useUserSchedule`, splits
  active/queued, renders the add-a-habit input.
- `HabitRow.tsx` — one active habit: daily checkbox, expandable steps panel, add/remove a step.
