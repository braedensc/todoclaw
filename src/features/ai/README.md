# ai

Opt-in→invite-only AI features. The whole planner works without AI; for the invite-only MVP,
AI is available to every signed-in (trusted) user and runs on the **owner's** Anthropic key,
server-side only (ADR-0014/0015). The frontend never sees the key — it calls Supabase Edge
Functions (`supabase/functions/`).

- **`use-ai-status.ts`** — `useAiStatus()`: queries the `ai-status` Edge Function for the
  caller's budget/rate-limit state. The panels use `paused` to show an "AI paused this month"
  notice when the global budget kill-switch has tripped.

Arriving next:

- **Plan My Day** (PR3) — `PlanMyDayPanel` (modal off the header button) + `use-plan-my-day`,
  backed by the `plan-my-day` Edge Function.
- **Chat** (PR4) — `ChatPanel` (streaming slide-over) + `use-ai-chat`, backed by the `ai-chat`
  Edge Function with user-scoped tools and confirmation before destructive actions.

Guardrails (rate limits + global monthly budget kill-switch) and the server-side architecture
live in `supabase/functions/README.md` and ADR-0015.
