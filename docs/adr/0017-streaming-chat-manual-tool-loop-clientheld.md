# ADR-0017 — Streaming chat: manual tool loop, client-held history, confirm-before-destructive

**Date:** 2026-06-25 · **Stage:** 4 (PR4)

The chat (`ai-chat` Edge Function + `ChatPanel`) is the largest, most security-sensitive surface:
conversational AI with tools that mutate the caller's tasks. Decisions:

- **Manual streaming loop, NOT the SDK auto tool-runner.** We want real token streaming AND a
  pause for confirmation/budget mid-conversation; the auto-runner loops straight to `end_turn` with
  no pause point. So we own the loop: `messages.stream()` per turn → stream `text` deltas →
  inspect `stop_reason` → execute tools or pause → feed `tool_result` back → repeat. Capped at
  `MAX_TOOL_ITERATIONS=8` per request (bounds runaway tool loops + budget burn).
- **Stateless / client-held history.** Edge Functions have no session, so the client holds the
  Anthropic `messages[]` and resends them each turn. The confirm round-trip echoes the history plus
  an accumulating `approvedToolUseIds` set. SSE event types: `text-delta`, `tool-result`,
  `tool-pending-confirmation`, `message`, `done`, `error` (in-band; HTTP stays 200 so partial text
  can stream before a failure).
- **Confirm before destructive ops — enforced in code, atomically.** `complete_task` and
  `delete_task` are a **server-side** destructive set (never trusted from the model). A per-turn
  **pre-scan** pauses and executes NOTHING in a turn until all its destructive tools are confirmed —
  so a resume can never re-run already-executed siblings (the multi-tool-in-one-turn hazard).
  Confirmation can't be forged: the model never sees or sets `approvedToolUseIds`; the client sets
  them only from a real user click. Decline is client-side (append a declined `tool_result`).
- **Prompt-injection containment.** Every tool DB write goes through the **caller's JWT** client
  (`auth.ts`), so RLS applies and the model never supplies `user_id` — task text that says "delete
  everything" can at worst touch the caller's own rows, and destructive ops still require
  confirmation. The system prompt frames task text as *data, not instructions*. Tool inputs are
  Zod-validated before any DB call (a hallucinated UUID matches zero rows → a clear "not found");
  the grid is seeded into the system prompt so the common edit case needs no `list_tasks` hop.
- **Placement tool (Discrepancy #5).** The due-date → x/y/staged auto-placement (BabyClaw/chat
  behaviour, never in the old client/server) is implemented fresh in `_shared/placement.ts` and used
  by `create_task` / `set_due_date`; exhaustively unit-tested at every bucket boundary.

**Verified:** `deno check` + 23 deno unit tests (placement boundaries, the `localDateInTZ` port,
tool schemas/validation/classification); the function via curl — 401 (no auth), 400 (malformed),
and a **200 SSE stream with a graceful in-band error** at the model boundary without a key (proving
the SDK/zod/supabase npm imports load in the edge runtime and auth/Zod/guardrail/grid-seed all run);
135 vitest incl. the SSE stream handling + the confirm round-trip (asserts the approved id is
resent) + the panel render (bubbles, the confirmation banner, paused). In-browser: the slide-over
opens, a send streams a user bubble + a graceful error, clean console. **Live tool execution** (the
model actually calling tools, and the confirmation dialog firing on a real destructive call) needs
the owner key — deployed, or local `supabase functions serve --env-file`.

**Deferred:** an MCP server exposing the same tools for the Claude app (Track 2) — the tool logic
lives in `_shared` so it can be reused without a reimplementation.
