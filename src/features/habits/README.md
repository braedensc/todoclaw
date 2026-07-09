# habits

Daily habits with expandable **details** (optional sub-steps; stored as `subtasks`). Parity ref:
`planning/eisenclaw-export/docs/eisenclaw.md` ("Daily Habits") + `pics/Todopic3.jpeg`.

## Where you check vs. where you set up

Two surfaces, split by job:

- **Home** (`RemindersInline`) — where habits get **ticked off** for the day (the inline list +
  its per-habit detail popup). This is the only place checkboxes live.
- **Daily habits setup** (`HabitsView`) — the **setup/management** surface: add / remove habits and
  edit their details, activate queued ones. It has NO daily checkboxes (habits aren't checked here).
  It's an overlay over a still-mounted home you dismiss by clicking/swiping out — a centered popup on
  desktop (`RemindersPage`), a bottom sheet on mobile (`RemindersSheet`); no explicit save/close
  (every add persists instantly). `HabitRow`'s `checkable` prop drives the two: `true` on home,
  `false` here (paw disclosure toggle + blue-paw detail bullets + a red "Remove").

## Model

A **habit** is its own row (`habits` table, `src/types/habit.ts`). Its **details** are an embedded
jsonb `subtasks` array on that row — there is no separate subtasks table (the daily map key stays
`subtask_done`). The client never sends `user_id` (DB default `auth.uid()` + RLS); "delete" is a
soft delete (`deleted_at`), mirroring tasks. Two display groups, by the `active` boolean:

- **Active** (`active === true`) — expandable rows with an optional details panel.
- **Queued** (`active === false`) — dashed "activate" buttons; tap to flip `active` true.

## Daily completion (resets every local day, non-destructively)

Which habits/steps are checked **today** lives in `daily_state`, NOT on the habit row:

- `habit_done` — `{ habitId: true }`
- `subtask_done` — `{ "habitId:subtaskId": true }` (composite key — see `subtasks.ts` `subtaskKey`)

That split is what makes the reset non-destructive: `useDailyState(tz)` keys its query by the
user's **local** calendar day, so crossing local midnight just reads a different (empty) row —
the habit rows are untouched. The day flip is LIVE (`useLocalToday`): an app left open overnight
re-keys on its own at midnight / on foreground, so habits visibly reset each morning without
waiting for a tap. Toggles go through the atomic merge RPC `set_daily_flag`
(`useToggleDailyFlag`), never a client read-modify-write, so concurrent toggles can't clobber
each other's jsonb edits.

**Habit check = master switch:** checking a habit also checks every detail, and unchecking clears
them (symmetric — an accidental check fully undoes itself). `habitDayWrites` (subtasks.ts) builds
the write list; callers fan it out through the same per-key atomic RPC. Details stay independently
toggleable for partial progress.

## Files

- `use-habits.ts` — TanStack hooks: `useHabits`, `useAddHabit`, `useUpdateHabit` (active toggle /
  rename / subtasks edits), `useSoftDeleteHabit`, `useToggleDailyFlag`. Mirrors `use-tasks.ts`.
- `subtasks.ts` — pure helpers (`subtaskKey`, `appendSubtask`, `removeSubtask`); split out so the
  component test can mock the hooks without re-exporting this logic.
- `HabitsView.tsx` — the setup page body: reads `useHabits` + `useDailyState(tz)` +
  `useUserSchedule`, splits active/queued, renders the add-a-habit input + a "Done" closer. Passes
  `checkable={false}` to its rows (management only).
- `HabitRow.tsx` — one habit row in two modes (`checkable`): the home popup (checkbox + name +
  checkable details) or the setup row (details toggle left of the name + a clear "Remove" button,
  no checkboxes). Add/remove a detail either way.
- `HabitCheck.tsx` — the paw-print check (PawMark visual + HabitCheckbox, a real input wearing
  the skin). One look across the inline home list, the detail card, and details — always `puppy`
  palette (with `BoneIcon` marks), so no surface swaps color when you tap into a habit.
