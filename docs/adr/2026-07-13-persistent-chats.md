# ADR 2026-07-13 — Persistent BabyClaw chats: server-authoritative history via a service-role write path

**Date:** 2026-07-13 · **Post-launch** (BabyClaw persistence, Part A of the persistence+memory epic)

BabyClaw conversations were **ephemeral and client-held**: `use-ai-chat.ts` kept the Anthropic message
array in a React ref and resent the whole thing every turn; the server accepted it as `z.array(z.any())`
and echoed an authoritative copy back for the client to re-adopt (#245). A refresh lost the chat, and the
`z.any()` shape let a hostile/XSS'd client inject arbitrary Anthropic blocks (a forged `tool_use` +
self-supplied `approvedToolUseIds` executes any capability on the caller's own rows with no model call).

This makes chats **durable and browsable** — and closes that class of forgery **structurally**, at the DB.

## Decision 1 — the transcript is server-authoritative, enforced at the DB (not just claimed)

Two new tables (`20260713050000_chat_sessions.sql`): `chat_sessions` + `chat_messages` (Anthropic-format
`content` jsonb + a UI-only `meta` sidecar). The load-bearing choice:

- **The client has NO write path.** `authenticated` gets `SELECT` + owner-scoped hard-`DELETE` only — **no
  INSERT, no UPDATE**. If it held INSERT, a client could PostgREST-insert a `role='assistant'` row (or a
  forged `pending` confirmation state) that then replays into every future model window and can substitute
  what a confirmation executes. Proven locally: an `authenticated` INSERT of a `role='assistant'` row and an
  UPDATE of `pending` both raise **permission denied**; a second user reads/deletes **0** of the first's rows.
- **All transcript writes go through `SECURITY DEFINER` RPCs fenced to `service_role`** — the `claim_message`
  pattern (ADR-0031): `chat_start_session` / `chat_append_message` / `chat_set_pending`. Each stamps
  `role`/`user_id` server-side and fences the session to the passed user id, so the model (or a forged
  client) can never mint an assistant turn or forge the confirmation state.

## Decision 2 — ai-chat gains a second, tightly-scoped service-role client

`_shared/auth.ts` now exports `adminClient()` (service_role). It is used **only** for the three chat_*
transcript RPCs. All **tool** DB writes (tasks/habits/memories) keep using `userClient` (caller JWT, RLS) —
a prompt-injected tool still can't escape the caller's own rows. This is the second deliberate service-role
touchpoint after `_shared/admin.ts` (invites/dispatch, ADR-0030/0031); it is justified by the forgery
closure and mirrors the same fencing. Caps are DB triggers as belt-and-suspenders (≤100 sessions/user,
≤2000 messages/session) — since the browser has no INSERT path, the edge-function caps are already authoritative.

## Decision 3 — typed request shape; confirm validates against the server-recorded pending

The request is fully typed (`{session_id?, message?, seed?, action?}`) — the `z.array(z.any())` history array
is gone, so the client never constructs Anthropic blocks and `approvedToolUseIds` disappears. Exactly one of
`message | action`. A confirm/deny `action` is validated against the **server-recorded** `pending`
(`{awaiting:{tool_use_id,name,summary}, approved:[]}`), never client-echoed state; `approved` accumulates so a
turn emitting two destructive tools doesn't livelock. Every unanswered `tool_use` in a halted turn is answered
on deny **and** on load-time repair (the denied id → "User declined"; siblings → "not executed"; an interrupted
turn → "interrupted"), so a resume can never leave a dangling `tool_use` that 400s at the Anthropic API — this
also closes the confirm-resume wedge #245 left open (rollback wasn't armed on resume).

## Windowing

`_shared/chat-store.ts` loads the newest 60 messages, cuts the head to a clean user turn (never orphaning a
`tool_result`), drops oldest whole turns past 50k serialized chars (re-cleaning the head after each drop),
merges consecutive same-role turns, and drops malformed rows with a server log. No summarization in v1 — old
context ages out of the prompt; the system prompt re-injects live task state fresh each turn. The user turn is
persisted **before** the model call, so an abort loses only partial assistant text.

## Consequences

- **Atomic cutover** (no dual-mode `{messages}` arm): the server and client ship close together; a stale open
  tab during the deploy gap costs one "Chat failed." + refresh. Overbuild for a single-digit-user invite app.
- **Hard delete + backup exclusion**: chats are AI meta (like history/daily_state) — not snapshotted by
  `create_backup`/`restore_backup`, and excluded from the external `pg_dump` (`backup.yml`) so deleted chats
  don't linger in rotated dumps. "Delete means delete."
- **No Realtime** (ADR-0021 stays deferred): freshness via TanStack `refetchOnWindowFocus` + invalidate-on-mutation.
- Directly satisfies the G2 "code-level containment of stored/LLM prompt-injection" hardening item.
