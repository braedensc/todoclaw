# ADR 2026-08-27 — The client-role EXECUTE surface is an explicit list, not an inherited default

**Date:** 2026-08-27 · **Post-launch** (security boundary) · **Status:** Accepted · generalises [ADR 2026-07-21](2026-07-21-weather-cache-service-only.md)

## The idiom that stopped working

Every server-only RPC in this project is fenced the same way:

```sql
revoke all on function public.f(...) from public;
grant execute on function public.f(...) to service_role;
```

That is a fence only while `anon` and `authenticated` hold their EXECUTE **through `PUBLIC`**. Up to
`supabase/postgres` **17.6.1.136**, they did: the `postgres` default ACL for functions in `public` was
`{postgres=X/postgres}` — PUBLIC revoked, no per-role grant — so revoking PUBLIC left the client roles
with nothing.

As of **17.6.1.165** that default ACL is:

```
{postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

Every function a migration creates is now born with an **explicit per-role grant** to `anon` and
`authenticated` — and `revoke … from public` cannot remove an explicit per-role grant. The fence
stopped fencing silently, with no change on our side and nothing in the repo to review.

The `rls-live` CI job caught it, but only through the two functions it happened to name by hand, and
the failure shape read like a local flake: `weather_cache_get/put` callable by `anon` only, and
`mint_invite` callable by `anon` **and** `authenticated`. That asymmetry is the tell — in each case
the roles left standing are exactly the ones the migration's revoke did not name.
`20260722000000` wrote `from public, authenticated`, so only `anon` survived; `20260818000000` wrote
`from public`, so both did.

## Blast radius

Measured by diffing `pg_proc.proacl` on a stack built from each image against a scan of
`supabase/migrations`:

| image | owned functions in `public` | over-granted |
|---|---|---|
| 17.6.1.136 | 70 | **0** |
| 17.6.1.165 | 70 | **69** |

The one correct function is `edge_ip_throttle`, and only because it genuinely wants `anon` +
`authenticated`. Everything else was reachable by a client role, including every `*_for_user(uuid, …)`
RPC — `dispatch_inputs_for_user`, `memories_for_user`, `push_subscriptions_for_user`,
`save_daily_plan_for_user`, `task_activity_for_user`, `claim_message`, `insert_reminder_message`,
`mint_invite`. Those take the target `user_id` as an **argument** because their only intended caller is
an edge function holding `service_role` that has already verified who is asking. Handed to `anon`, they
are cross-tenant read and write, not a theoretical exposure.

## Decision

Stop inheriting. The client-role EXECUTE surface in schema `public` is now stated explicitly and
asserted on every PR.

1. **Take EXECUTE out of the default ACL** (`alter default privileges in schema public revoke execute
   on functions from public, anon, authenticated`), so a function created by a future migration is born
   with no client-role grant whatever the image's defaults say. Supabase's own `supabase_admin` default
   ACL is left alone — it governs platform-created objects (storage, graphql), not ours.
2. **Blanket-revoke, then re-grant by signature** — 21 functions, listed in migration
   `20260827020000`. This is a restatement, not a change: those 21 are precisely the net EXECUTE grants
   the migration history already expresses, and precisely what a pre-17.6.1.165 stack ends up with.
3. **Assert it** — `scripts/check-rls-live.mjs` gains **check I**, which compares the live ACLs against
   a reviewed `CLIENT_CALLABLE_FUNCTIONS` map and fails on an extra role, a *missing* role (a client
   RPC silently losing EXECUTE is the 2026-07-13 mint outage shape), or a default ACL that still
   promises EXECUTE on future functions.

Check I generalises the hand-written probes E and H. Those stay — they assert behaviour end to end
(`42501` on call, plus a `service_role` positive control), which an ACL comparison does not.

### Why not keep pinning functions one at a time

Probes E and H were each written after an incident, naming one function. That scales with incidents, not
with the schema, and it is what let a default-ACL change reach 69 functions while CI reported 4. A
whole-schema invariant with a reviewed exception list fails on the *next* one by name, before it is an
incident.

## The CLI pin

`rls-live` was the only job on `supabase/setup-cli@v2` with `version: latest`; `deploy.yml` and
`migration-drift.yml` were already pinned to `2.107.0`. It is now pinned to **`2.116.0`** — pinned
*forward*, to the version carrying the new default, so the hardened behaviour stays under test.
Downgrading it to match the other jobs would turn the check green by testing the pre-change world; the
skew is deliberate, and those jobs talk to the managed project, whose postgres image the CLI version
does not decide.

The trade-off is real: `latest` is what surfaced this at all. What it cannot do is surface it *safely* —
it broke every open PR simultaneously, with a diagnosis that looked like it belonged to whichever branch
noticed first. Bumping the pin is now a PR whose only job is that bump.

## Consequences

- A new client-callable RPC needs a `grant execute` in its migration **and** an entry in
  `CLIENT_CALLABLE_FUNCTIONS`, or `rls-live` fails naming it. That is the intended review step.
- `revoke … from public` alone is no longer sufficient anywhere. Name the client roles.
- The migration is a no-op against an already-correct database — verified by applying it inside a
  rolled-back transaction on a 17.6.1.136 stack: the client-role grant set is bit-identical before and
  after. It is therefore safe on the managed project whether or not that project ever acquired the
  permissive default.
- Whether the managed project **did** acquire it is a separate question, answered by reading
  `pg_default_acl` and `pg_proc.proacl` there. Per-function, not one yes/no: prod's ACLs were frozen at
  each migration's own run date, so a project can be holed on `mint_invite` (2026-08-18) and clean on
  `weather_cache` (2026-06-24 / 07-22), or the reverse.
