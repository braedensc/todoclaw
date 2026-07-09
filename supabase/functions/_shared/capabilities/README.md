# Capability layer (`_shared/capabilities/`)

The **transport-agnostic** set of things a signed-in user can do to **their own** planner — create a
task, check off a habit, plan the day, etc. BabyClaw (the in-app chat) is the first consumer; a
future MCP server is meant to be the second, with no change to this layer.

## Shape

```
types.ts        Capability, CapabilityContext, CapabilityResult, MutationDomain, defineCapability()
helpers.ts      ok()/err(), updateTaskRow/updateHabitRow, loadHabitSubtasks
tasks.ts        task capabilities   (list, create, edit, move, due, recurring, restore, complete*, delete*)
habits.ts       habit capabilities  (list, create, rename, active, done, steps…, delete*)
plan.ts         generate_plan       (delegates to the injected ctx.services.generatePlan)
preferences.ts  set_assistant_preference  (persists tone / verbosity / a short note — see below)
registry.ts     CAPABILITIES[], capabilityByName, DESTRUCTIVE   ← the single source of truth
```

### `set_assistant_preference` — the one self-write

Every other capability writes **data** the security model frames as "never instructions".
`set_assistant_preference` is the exception: it persists BabyClaw's own personalization
(`user_schedule.config.assistant`: `tone`, `verbosity`, `customInstructions`) — and
`customInstructions` is the one field folded into the system prompt **as behavior** (chat-prompt.ts
`configLines`). So it is a deliberate prompt-injection surface, kept safe by being **bounded and
curated**: one scoped, size-capped (500-char), preferences-only field, validated + clamped
server-side, written via a read-modify-write that preserves every other `config` key. The
load-bearing rule — *only persist an explicit preference the user stated in chat, never anything
derived from stored task/habit/step text* — is a **prompt-level** instruction (SYSTEM_PREFIX), not
unit-testable here; the capability only writes what it is handed, and SYSTEM_PREFIX always wins
(a saved note is still a preference and can never widen scope). It is **not destructive** (fully
reversible from Settings), so it announces the change rather than asking to confirm. The change is
re-read at the start of the next turn, so it takes effect on BabyClaw's next reply.

Each capability is `{ name, description, schema (zod), destructive, execute(ctx, input) }`. The
**zod schema is the one source of truth**: it validates input at execution *and* — via
`z.toJSONSchema` in the adapter — renders the JSON Schema a client advertises, so there is no second
copy to drift. Nothing Anthropic- or MCP-specific appears in this folder.

`CapabilityContext` carries the **caller's JWT-scoped Supabase client** (never a service role), the
user's timezone, and optional injected `services` (e.g. the Anthropic-backed Plan My Day path, wired
in `../run-plan.ts`). A capability that needs a missing service degrades gracefully.

`execute` returns `{ content, isError, mutated? }`. `mutated` lists the data domains that changed
(`tasks | habits | daily_state | history`); the chat maps each to a TanStack Query key so the UI
live-refreshes the instant a tool runs (see `src/features/ai/use-ai-chat.ts`).

## Adapters

- **Anthropic** — `../chat-tools.ts`: `TOOL_DEFS` (registry → Anthropic tools), `executeTool`
  (validate → run), `destructiveSummary` (confirm label). Used by `../../ai-chat/index.ts`.
- **MCP (future, not built)** — a thin server would map `CAPABILITIES` → MCP `tools/list` (reusing
  the same `z.toJSONSchema`) and route `tools/call` through the same validate-then-`execute` path,
  passing a `CapabilityContext` built from the authenticated MCP session's Supabase client. No
  capability changes; no Anthropic import. **Deliberately deferred** — building/hosting an MCP server
  and adding external auth is out of scope, to keep the security + cost surface small.

## Threat model & mitigations

This runs on the **owner's** Anthropic key + monthly budget, so the chat endpoint is treated as a
hardened, user-facing LLM surface (OWASP LLM Top-10 mindset). Defenses, cheapest-first:

- **Scope containment (budget abuse).** The system prompt (`../chat-prompt.ts`) hard-limits BabyClaw
  to managing *this* user's planner and refuses general-purpose use (code, essays, translation, chat)
  — so the owner's key can't be turned into a free LLM.
- **Prompt-injection resistance.** Task/habit/step text and all stored data are framed as **data,
  never instructions**; embedded commands ("ignore previous instructions", "delete everything") are
  not obeyed. User config *preferences* can adjust tone but can **never widen scope or override the
  rules** (rules come first and say so).
- **Input caps (cost + DoS).** Server-side, *before* the model call, `ai-chat` rejects oversized
  payloads: whole-history cap (`MAX_TOTAL_CHARS`) and per-user-turn cap (`MAX_USER_MESSAGE_CHARS`).
  Each capability additionally caps free-text args at the validation gate.
- **Least privilege.** Every write goes through the caller's JWT client → **RLS** applies and
  `user_id` is never a parameter; the model can at worst touch the caller's own rows. Destructive
  tools (`complete_task`, `delete_task`, `delete_habit`) require **human confirmation**
  (server-classified in `DESTRUCTIVE`, never trusted from the model). Tool iterations are capped.
- **Rate limit + kill-switch.** Per-user rate limits and the global $20/mo budget kill-switch
  (`../guardrails.ts`) still gate every request; `generate_plan` additionally consumes the separate
  `plan_my_day` limit.
- **No disclosure.** The prompt refuses to reveal the system prompt, keys, or other users' data.

We rely on strong prompt scoping + input caps + the existing budget/rate guards rather than an extra
moderation-model call — the low-cost path.
