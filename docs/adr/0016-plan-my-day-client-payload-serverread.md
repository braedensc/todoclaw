# ADR-0016 — Plan My Day: client payload + server-read schedule, structured output via forced tool use

**Date:** 2026-06-24 · **Stage:** 4 (PR3) · **Status:** Accepted

Plan My Day is a `plan-my-day` Edge Function + a modal panel. Decisions:

- **Client builds the task payload; the function reads the schedule.** The frontend assembles the
  day's data (`buildPlanRequest`) reusing the *same* `src/lib` scoring/recurring/date logic the grid
  and list use — so the "on-grid = not staged, not done today, not recurring" filtering and the
  tz-aware `daysUntil` live in ONE place, not re-implemented in Deno. But the **schedule + timezone
  are read server-side** from `user_schedule` (authoritative, not client-trusted), and **weather** is
  fetched server-side. This mirrors the original (client sent task/habit lines; server held the
  schedule) while keeping the trust boundary right.
- **Structured output via forced tool use, not fence-stripping.** The function calls Anthropic with a
  single `emit_plan` tool and `tool_choice: {type:'tool'}`, then reads the tool-use input as the plan.
  This guarantees a parseable, schema-shaped `{headline, availableTime, bigRock|null, smallRocks[],
  habitNote}` — retiring the original server's brittle ` ```json `-fence `JSON.parse` (LOGIC-TO-PORT
  §12). Robust across SDK versions (no reliance on a specific structured-output API).
- **Prompt redesigned, not ported verbatim.** Same inputs (schedule slots, weather, "habits must
  appear", weekend/Sunday handling, "never schedule running") but restructured for reliability:
  assess-urgency-first, an explicit "a light/rest day is valid" path, firmer "don't cram". Lives in
  `_shared/plan-prompt.ts`, unit-tested (weekday/Saturday/Sunday branches, empty grid).
- **Weather cache** (`weather_cache`, migration `20260624020000`): a shared ~30min cache so repeated
  clicks don't hammer wttr.in. Global state, so the same pattern as `ai_budget_ledger` — RLS on with
  no grants/policies, reached only via DEFINER `weather_cache_get/put` (no service-role key).
- **Guardrails reused:** `precheck('plan_my_day')` (10/day) + the global budget kill-switch; the
  panel reads `useAiStatus().paused` to show an "AI paused this month" notice up front. (Known minor:
  a failed attempt still counts one rate-limit unit, since precheck records before the model call —
  acceptable, and it bounds retry-spam.)

**Verified:** migrations apply; the function was driven via `supabase functions serve` + curl —
401 without auth, 400 on a malformed payload (Zod), and a graceful structured error at the model
boundary without a key (proving the SDK/zod npm imports load in the edge runtime and the whole
auth→guardrail→schedule→weather pipeline runs). 9 frontend + 5 prompt-builder unit tests green.
**Live model verification** (a real generated plan) needs the owner key set locally (`--env-file`)
or the deployed function — the panel renders plan/paused/loading/error states are unit-tested.
