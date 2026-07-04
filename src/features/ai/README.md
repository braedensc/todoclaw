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
  different date's row). The plan shape + its Zod validator live in `src/types/plan.ts`.

- **`ChatPanel.tsx`** + **`use-ai-chat.ts`** — Chat (PR4). A right slide-over that streams the
  assistant's reply token-by-token and pauses for **confirmation before any destructive action**
  (complete / move-to-trash). `use-ai-chat` fetches the `ai-chat` Edge Function directly (so it can
  read the SSE stream — `functions.invoke` doesn't stream), holds the conversation client-side, and
  drives the confirm/decline round-trip. Tools are user-scoped (RLS); the model never sets
  `user_id`. See ADR-0017 + `supabase/functions/README.md`.

- **`AiPrivacyNote.tsx`** — a short, honest disclosure shown in both AI panels: AI runs on the
  owner's Anthropic key, your task/message text is sent to Anthropic, and chat isn't saved. The
  full opt-in **consent gate** is still deferred (ADR-0014/0015); this is the lightweight notice.

Guardrails (rate limits + global monthly budget kill-switch) and the server-side architecture
live in `supabase/functions/README.md` and ADR-0015.
