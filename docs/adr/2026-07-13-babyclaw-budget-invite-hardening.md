# ADR 2026-07-13 — BabyClaw hardening: bind AI budget spend to usage; owner-only invite mint

**Date:** 2026-07-13 · **Post-launch** (security audit follow-up)

A 2026-07-13 security review of the BabyClaw AI-chat system found two authenticated-but-privileged
holes that share one shape: an owner-only / server-only intent that was enforced **only in the Edge
Function**, while the underlying table/RPC was still reachable **directly via PostgREST** with the
public anon key (already in the frontend bundle). Both are closed below the function, at the DB
boundary, so the Edge Function is no longer the only thing standing between a signed-in user and the
sensitive operation. Neither introduces a new service-role touchpoint beyond the one that already
exists (`_shared/admin.ts`, ADR-0030).

## M2 — the AI budget kill-switch could be tripped for everyone (availability)

**Hole.** `ai_budget_add` is granted to `authenticated`. The 20260706 hardening clamps a single call
to $0.20 and rejects negatives, but nothing limited how *often* it is called, and it writes the
**global** `ai_budget_ledger`. Any invited user could skip the Edge Function and `POST
/rest/v1/rpc/ai_budget_add` ~100× to add ~$20 and trip the monthly kill-switch for **all** users
until the next UTC month — bypassing the rate limit (a separate RPC) and the per-user sub-cap (which
only gated `precheck`, not the add). Availability only: the ledger can't go negative, so it can pause
AI but not overspend.

**Decision — the ledger may move only in step with a real, rate-limited usage row.**
`ai_budget_add(p_usage_id uuid, p_micros bigint)` now takes the usage-row id that
`ai_usage_check_and_record` already returns to `precheck`, and under a `FOR UPDATE` row lock requires
that row to be the caller's own (`user_id = auth.uid()`) and not-yet-billed; it stamps a new
`ai_usage.billed_at` and only then increments both ledgers. Properties:

- **Idempotent** per usage row — a retry or a replayed call is a no-op, never a double-count.
- **Unforgeable** — you cannot move a ledger without a genuine usage row behind it, and usage rows
  are bounded by the hourly/daily rate limits. Once a user's per-user monthly ledger reaches the $10
  sub-cap, `precheck` blocks the creation of new usage rows, so a single account can contribute at
  most ~its $10 slice to the global $20 pool — and only by actually consuming its own rate-limited
  calls. The standalone amplification is gone.
- **Period-honest** — the increment lands in the ledger period of the *usage row* (`called_at`), so
  the current kill-switch ledger can be moved only by a *current-period* usage row; old unbilled rows
  bill their own (unread) past period and can never spike the live switch. In the normal path the two
  periods are the same second.

`billed_at` is written **only** by this `SECURITY DEFINER` function (it runs as the table owner, so
the narrowed column-level UPDATE grant on `ai_usage` doesn't apply to it); `authenticated` has no
direct grant to write it. The cost is still supplied + clamped exactly as before — binding to a usage
row is an *additional* gate, not a change to the cost model. `guardrails.ts` `recordUsage` passes the
`usageId` it already holds.

The system/cron path (`ai_budget_add_for_user`, 20260707140000) is `service_role`-only — not reachable
by `authenticated`, so not a grief vector — and is intentionally left as the `p_micros` form (only
the trusted backend may name a user). It doesn't need the usage-row gate.

*Considered and deferred:* an owner-only fast-recovery RPC to lower/zero a tripped period. After M2
the blast radius is bounded to a user's own $10 slice and requires real rate-limited spend, so a
malicious trip is far less likely and recovery via raw service-role SQL (unchanged from today) is an
acceptable rare-case cost. Adding a recovery RPC with no admin-UI caller would be dead surface.

Migration: `20260713010000_ai_budget_add_bind_usage.sql`.

## L3 — any authenticated user could mint invite codes (authorization)

**Hole.** `generate-invite` is owner-only (`isOwner`), but it inserted under the caller's JWT and
relied on the `invites_insert_own` RLS policy, with `insert` granted to `authenticated`. A non-owner
could bypass the function and `POST /rest/v1/invites` directly with `{max_uses: 1000000, expires_at:
null, owner_id: <self>}` — the `with check (owner_id = auth.uid())` is satisfied and `claim_invite_code`
(which never checks `owner_id` is the real owner) honors the code. So any trusted user could mint
unlimited-use, non-expiring invites and onboard arbitrary accounts, each spending the shared owner
budget — defeating the owner-vouched, invite-only intent (ADR-0030/0014) and compounding M2.

**Decision — invite creation is owner-only *below* the Edge Function.**

- **Revoke the direct `insert` grant** on `public.invites` from `authenticated` and **drop the
  `invites_insert_own` policy**. There is now no PostgREST insert path for app roles;
  `invites_select_own` / `invites_update_own` stay so the owner can still list and revoke (revoke is
  an UPDATE).
- **Mint via the service-role admin client.** `generate-invite` now inserts through
  `_shared/admin.ts` (the single existing service-role client, as `redeem-invite` already does),
  which bypasses RLS; since there is no `auth.uid()` under service role, `owner_id` is set explicitly
  to the `isOwner()`-verified `user.id`. `isOwner()` remains the one gate — the DB simply no longer
  offers a second door.
- **Defense-in-depth CHECK constraints** mirror the function's caps so even the owner path (or a
  future admin bug) can't mint an absurd code: `max_uses between 1 and 50`, and `expires_at is not
  null` (no never-expiring codes). The ≤ 90-day bound stays in the function — a CHECK can't reference
  `now()`, so the DB requires an expiry to *exist* but not how far out.

Migration: `20260713020000_invites_owner_only_mint.sql`.

## Verified (local Supabase, `supabase db reset`)

- **M2 (psql + PostgREST).** A `authenticated` JWT calling `ai_budget_add` with a made-up, foreign, or
  already-billed usage id is rejected (`usage_not_found` / no-op) and the global ledger does **not**
  move; a 20× direct-RPC spam loop moved it by **0**. Negatives → `invalid_micros`; no `sub` →
  `not_authenticated`. A valid own usage row bills exactly once (idempotent re-call is a no-op), an
  over-ceiling amount clamps to $0.20, and `billed_at` is stamped. A `recordUsage` unit test guards
  the client-side wiring (`p_usage_id` is passed).
- **L3 (psql + PostgREST).** `authenticated` has SELECT + UPDATE but **not** INSERT on `invites`; the
  insert policy is gone, select/update-own remain; a non-owner JWT `POST /rest/v1/invites` returns
  **403 / 42501 permission denied** (while the same JWT can still SELECT — the token is valid, the
  grant is not). The CHECK constraints reject `max_uses > 50` and null `expires_at` on any path; the
  owner (admin-client) mint of a valid code succeeds and `claim_invite_code` still redeems it.
- Full suites green: 213 Deno tests, 607 Vitest, typecheck, lint, `format:check`.
