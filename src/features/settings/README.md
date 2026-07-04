# settings

The user-facing configuration surface: a dismissible modal (`SettingsPanel`) opened from a header
link. It edits the single `user_schedule.config` jsonb blob — no new table, no migration.

## What it configures

- **Schedule** — location + weekday hours (wake/work/lunch/bedtime + free-time estimate), weekend
  free-time and Sunday long-run window, and optional running/marathon context. Modeled on the
  original EisenClaw shape (`planning/eisenclaw-export/data/user-schedule-braeden.json`).
- **Plan My Day preferences** (`config.planNotes`) — one bounded freeform note (≤500 chars).
- **BabyClaw** (`config.babyclaw`) — tone, verbosity, and bounded custom instructions (≤500 chars).

## Why it matters

The Plan My Day edge function reads `config` **server-side**
(`supabase/functions/_shared/plan-prompt.ts`). Before this editor existed the prompt fell back to
hardcoded assumptions (work 9:30–17:00, lunch at noon, ~4.5h free). Filling the schedule here makes
the plan reflect the user's real day — no code change on the AI side is needed, the keys already
line up.

## Ownership & coordination

- This feature **owns the canonical config schema** (`src/types/user-schedule.ts:ScheduleConfigSchema`)
  and is the **only writer** of `config`. BabyClaw (B10) **reads** `config.babyclaw` / `config.planNotes`
  defensively with fallbacks — keep those key names stable.
- Plan My Day stays a **separate** function from BabyClaw; BabyClaw triggers it via its own tool.

## Safety

Every freeform field is length-capped in two places: `maxLength` on the input and a Zod cap
re-validated on save (`ScheduleConfigSchema`). `planNotes` and `babyclaw.customInstructions` are
injected into the AI prompts as **fenced, clearly-labeled preferences layered on the fixed
scaffold** — never as instructions. They cannot change the output schema, widen scope, or reveal
system details (see rule 6 in `SYSTEM_PROMPT` and the USER PLANNING PREFERENCES block in
`buildUserPrompt`). No raw system prompt is ever exposed for editing.

## Files

- `SettingsPanel.tsx` — the modal (BackupsPanel overlay pattern) + form sections + save.
- `settings-form.ts` — pure `configToDraft` / `draftToConfig` mapping (flat form model ⇄ nested
  config), number parsing/clamping, empty-field pruning. Unit-tested.
- The save mutation (`useSaveScheduleConfig`) lives with the row's other hooks in
  `src/features/schedule/use-user-schedule.ts` (reuses the query key; RLS scopes the write).
