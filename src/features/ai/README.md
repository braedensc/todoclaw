# ai

Opt-in→invite-only AI features. The whole planner works without AI; for the invite-only MVP,
AI is available to every signed-in (trusted) user and runs on the **owner's** Anthropic key,
server-side only (ADR-0014/0015). The frontend never sees the key — it calls Supabase Edge
Functions (`supabase/functions/`).

- **`use-ai-status.ts`** — `useAiStatus()`: queries the `ai-status` Edge Function for the
  caller's budget/rate-limit state. The panels use `paused` to show an "AI paused this month"
  notice when the global budget kill-switch has tripped.
- **`PlanBox.tsx`** + **`use-plan-controller.ts`** + **`use-plan-my-day.ts`** — Plan My Day. A
  **persistent inline card** above the grid (not a modal), closely mirroring EisenClaw's parchment
  plan card. `buildPlanRequest` (pure, tested) assembles the day's tasks/recurring/habits from the
  existing hooks + `src/lib` scoring/recurring; `usePlanMyDay` calls the `plan-my-day` Edge Function
  and, on success, **persists** the plan onto today's `daily_state` row via the `save_daily_plan`
  RPC (keyed by the user's local date). `usePlanController` wires the header "Plan My Day" button
  (the generate trigger) to `PlanBox`, which renders the structured
  `{headline, availableTime, bigRock, smallRocks, habitNote}` and **hydrates from `daily_state.plan`
  on load** — so the plan survives reloads and auto-clears at local midnight (a new day reads a
  different date's row). The plan shape + its Zod validator live in `src/types/plan.ts`. Each rock
  carries a `taskId` (stamped server-side from the model's `[T#]`/`[R#]` line ref), and the card
  **scratches a rock off live** (✓ + strikethrough) once its task is completed — anywhere: grid ✓,
  list, mobile, or BabyClaw — via `usePlanController.rockDone` → `src/lib/plan-done.ts`, which reads
  the same tasks/daily-state caches every done-path updates. The evening check-in matches by the
  same `taskId` (`_shared/dispatch.ts`), so it acknowledges what's already crossed off instead of
  re-asking.

- **`ChatPanel.tsx`** + **`use-ai-chat.ts`** — **BabyClaw**, the in-app planning assistant. A right
  slide-over that streams BabyClaw's reply token-by-token and pauses for **confirmation before any
  destructive action** (complete / delete task / delete habit). It drives the full 24-capability
  set — tasks, **habits** (create/rename/steps/check-off), Plan My Day, and **preference-setting**
  (`set_assistant_preference`) — via a transport-agnostic
  capability registry (`supabase/functions/_shared/capabilities/`, MCP-ready). `use-ai-chat` fetches
  the `ai-chat` Edge Function directly (to read the SSE stream — `functions.invoke` doesn't stream),
  and drives the confirm/decline round-trip. The transcript is **server-authoritative and persistent**
  now (persistent-chats ADR): the client sends a single `{ session_id, message }` or `{ session_id,
  action }` — never history — and renders the opened session's hydrated base (`use-chat-messages`) plus
  this visit's live-streamed turns; the session list is `use-chat-sessions`. On each successful
  **mutating** tool result the server reports which data domains changed, and `use-ai-chat`
  **invalidates the matching TanStack Query keys so the grid/list/habits/Done live-refresh instantly**
  (`DOMAIN_QUERY_KEYS`). Tools are user-scoped (RLS); the model never sets `user_id`. Persona +
  security rules + the threat model live server-side. See ADR-0017 + `supabase/functions/README.md`
  + `capabilities/README.md`.

  BabyClaw reads a small per-user config (`user_schedule.config.assistant`: `tone`, `verbosity`,
  optional `customInstructions`) folded into its prompt with safe defaults, and can now **write it**
  too: `set_assistant_preference` persists a preference the user states in chat ("keep it playful",
  "stop suggesting morning tasks") so it survives across sessions — it re-reads on the next turn, so
  the change lands on BabyClaw's next reply. This composes with the Settings editor (Settings → AI):
  same `config.assistant` field, two surfaces (chat + Settings), just as a task is editable from both
  chat and the grid — one canonical vocabulary (`ASSISTANT_TONES` / `ASSISTANT_VERBOSITY`) shared by
  both. Custom instructions are always treated as **preferences** and can never widen
  scope; the write is deliberately **bounded** (one scoped, 500-char, preferences-only field) — that
  boundedness is the safety property. See `capabilities/README.md` (`set_assistant_preference`).

- **`AiPrivacyNote.tsx`** — a short, honest disclosure kept in **Settings → "AI & privacy"**: AI
  runs on the owner's Anthropic key, your task/message text is sent to Anthropic, your conversations
  and memories are saved (and deletable — chats from the history, memory from Settings → AI). The full
  opt-in **consent gate** is still deferred (ADR-0014/0015); this is the lightweight
  notice. Moved out of the chat window (2026-07-06) so the assistant UI isn't cluttered — the
  disclosure now lives once, in Settings.

Guardrails (rate limits + global monthly budget kill-switch) and the server-side architecture
live in `supabase/functions/README.md` and ADR-0015.
