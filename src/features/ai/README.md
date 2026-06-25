# ai

Opt-in→invite-only AI features. The whole planner works without AI; for the invite-only MVP,
AI is available to every signed-in (trusted) user and runs on the **owner's** Anthropic key,
server-side only (ADR-0014/0015). The frontend never sees the key — it calls Supabase Edge
Functions (`supabase/functions/`).

- **`use-ai-status.ts`** — `useAiStatus()`: queries the `ai-status` Edge Function for the
  caller's budget/rate-limit state. The panels use `paused` to show an "AI paused this month"
  notice when the global budget kill-switch has tripped.
- **`PlanMyDayPanel.tsx`** + **`use-plan-my-day.ts`** — Plan My Day (PR3). A transient modal off
  the header button that generates today's schedule-aware plan. `buildPlanRequest` (pure, tested)
  assembles the day's tasks/recurring/habits from the existing hooks + `src/lib` scoring/recurring;
  `usePlanMyDay` calls the `plan-my-day` Edge Function; the panel renders the structured
  `{headline, availableTime, bigRock, smallRocks, habitNote}`.

- **`ChatPanel.tsx`** + **`use-ai-chat.ts`** — Chat (PR4). A right slide-over that streams the
  assistant's reply token-by-token and pauses for **confirmation before any destructive action**
  (complete / move-to-trash). `use-ai-chat` fetches the `ai-chat` Edge Function directly (so it can
  read the SSE stream — `functions.invoke` doesn't stream), holds the conversation client-side, and
  drives the confirm/decline round-trip. Tools are user-scoped (RLS); the model never sets
  `user_id`. See ADR-0017 + `supabase/functions/README.md`.

Guardrails (rate limits + global monthly budget kill-switch) and the server-side architecture
live in `supabase/functions/README.md` and ADR-0015.
