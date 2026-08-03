# ADR 2026-07-22 — Proactive memory: confident inferences auto-save (drop `propose_memory`'s confirmation gate)

**Date:** 2026-07-22 · **Post-launch** (BabyClaw memory; changes a security boundary) · **Status:** Accepted · relates to [ADR 2026-07-13-persistent-chats](2026-07-13-persistent-chats.md)

BabyClaw keeps durable **facts** about the user in `assistant_memories`, rendered into the chat
system prompt as a DATA block (`chat-prompt.ts` `memoryBlock`) and — since #312's plan work — folded
into Plan My Day. Two tools write it: `save_memory` (something the user **said**) and `propose_memory`
(a pattern BabyClaw **infers**). Until now `propose_memory` was classified **destructive**, so every
inferred memory paused for a human click before it was written.

Two problems with that gate:

- **The product wants ChatGPT-style memory.** The owner asked BabyClaw to *form memories on its own* —
  notice a routine, remember it, move on. A confirm card on every inference makes that feel like
  paperwork, and in practice suppresses the feature: the assistant stops proposing rather than nag.
- **The confirm gate was never the real safety layer.** An inferred memory is text BabyClaw already
  chose to write; the human click only rate-limited it. The actual containment (below) sits in code and
  the DB and does not depend on the click.

## Decision — a confident inference auto-saves

`propose_memory` is **no longer destructive** (`capabilities/memories.ts`): it writes straight through
like `save_memory`, and the prompt instructs BabyClaw to **mention what it saved** in its reply so the
save is always visible. `save_memory` (user-stated facts) is unchanged. The system prompt's MEMORY
paragraph now makes proactive saving the **default**, gated by a **durability test** ("still useful
next week?") with a soft ceiling of *a few per conversation* — replacing the old "at most one unprompted
save per conversation" throttle.

## The removed layer, and the layers that remain

Removed: **`propose_memory`'s human-confirmation gate** (it dropped out of the server-classified
`DESTRUCTIVE` set, which is derived from each capability's own flag). What still bounds the surface —
none of which depended on the click:

- **Prompt scoping.** The MEMORY rules forbid saving anything **derived from stored task/habit/step
  text** (data, never instructions), any **secret or sensitive detail** (health, finances, other
  people) unless the user explicitly asks, and duplicates of what the app already shows. Facts are
  DURABILITY-gated, one per memory, third person, ≤240 chars.
- **DB-enforced caps** (independent of what the model passes): **240-char `CHECK`**, **30-row/user
  trigger**, **dedup unique index** on `lower(btrim(content))`, plus the ai-chat **per-request write
  brake** (`MAX_MEMORY_WRITES_PER_REQUEST = 2`) so a single turn can't churn out memories.
- **Render-time defanging.** `sanitizeForPrompt` single-lines each memory and neutralizes the `"""`
  fence, `=== SECTION ===` header, and `[[status:]]` marker — a stored fact can never forge prompt
  structure. (`propose_memory` still **skips the provenance code-gate** — an inference isn't
  user-verbatim text — exactly as before.)
- **Full user control.** Every memory is listed in Settings → AI and can be edited or deleted; the
  `memoryEnabled` kill switch turns writes off entirely (the tools vanish from the advertised set).
- **Owner-key budget.** Memory writes go through the **caller's JWT** (RLS), not `ai_usage`, so they
  don't consume the AI budget — but the request itself is still gated by the monthly budget/rate limits.

## Consequences

- BabyClaw forms and saves confident inferences without interruption; each is announced in-reply and
  fully user-reversible. `delete_memory` **remains destructive** (an irreversible delete still confirms).
- `propose_memory` no longer produces a confirmation summary; the dead `destructiveSummary` branch is
  removed. The `DESTRUCTIVE`-set pins in `chat-tools.test.ts` and `capabilities/registry.test.ts` are
  updated to exclude it.
- The threat posture shifts from *"a human vets each inference"* to *"the model may write a durable,
  re-injected note within tight, code-enforced bounds, and the user can prune it."* This is an
  acceptable trade for an invite-only app on the owner's key; if abuse appears, the cheapest re-add is a
  per-day memory-write cap, not a return of the per-write click.
