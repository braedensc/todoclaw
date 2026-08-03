# ADR 2026-07-21 — Weather cache is server-only: revoke the `authenticated` grant, write via service_role

**Date:** 2026-07-21 · **Post-launch** (security fix, cross-tenant) · **Status:** Accepted · amends [ADR-0016](0016-plan-my-day-client-payload-serverread.md)

`weather_cache` is a **global, un-scoped** table (PK = `location`, no `user_id`), fronted by the
`SECURITY DEFINER` RPCs `weather_cache_get/put`. The original migration (`20260624020000`) granted
both to **`authenticated`** and reached the cache "under the caller's JWT" — with only an
`auth.uid() is null` login check on `put`, no ownership check, and an unbounded `text` payload.

That is a cross-tenant hole. Any invited (`authenticated`) user could call, directly over PostgREST:

```
supabase.rpc('weather_cache_put', { p_location: '<a victim's city>', p_data: '<misleading text>' })
```

and (1) **poison another user's plan**: `getWeather()` serves the cached value for the ~30-min TTL,
and `plan-my-day` / `run-plan` fold it verbatim into that victim's Anthropic prompt (`=== WEATHER ===`)
— so attacker-authored text reaches a *different* user's LLM; and (2) **storage-bomb** the table with
unbounded distinct location keys × unbounded payloads that carry no owner to clean up per-user.
Invite-only doesn't neutralize it — the boundary crossed is *between tenants*, not into the app.

## Decision — the weather cache is server-only

Migration `20260722000000_weather_cache_service_only`:

- **Revoke `weather_cache_get/put` from `public`/`authenticated`; grant to `service_role` only.** The
  edge functions (`plan-my-day`, `run-plan`) now call them with `adminClient()` — the same
  service-role path introduced for the chat-transcript RPCs ([ADR 2026-07-13-persistent-chats](2026-07-13-persistent-chats.md)).
  `getWeather()` takes that service-role client and uses it *solely* for the two cache RPCs (never a
  user table), so passing it is not a privilege widening.
- **The cached VALUE is always server-derived.** It is the summary the function itself fetched from
  wttr.in (or a fixed sentinel), never client text. A user can still influence *which* location key
  gets a real forecast; they can no longer control *what string* is stored under it. The poisoning
  vector is closed at the source.
- **Drop the `auth.uid() is null` guard** in both bodies: service_role has a null `auth.uid()`, so
  that check would now reject the only legitimate caller. The EXECUTE grant is the fence.
- **Defense in depth:** `weather_cache_put` caps `p_data` (`left(…, 2000)`; real summaries ~80 chars),
  and the prompt builder sanitizes+caps the cached text before folding it (`sanitizeForPrompt`, same
  treatment as memories/notes) so even a pre-fix-poisoned row can't forge a section header. The table
  is truncated in the migration to flush any poison/bomb rows already written.

## Consequences

- Clients have **no** read or write path to `weather_cache` — it is reachable only by the server.
- The write path is now the second+third use of `adminClient()`, still confined to DEFINER RPCs
  fenced to `service_role`; no tool write moves off `userClient`/RLS.
- **Verified:** `scripts/check-rls-live.mjs` (CI `rls-live` job, real applied schema) gained probe E —
  `authenticated`/`anon` calling either RPC must get `42501` permission-denied, and `service_role`
  must still succeed (positive control, so a missing function can't pass the denials vacuously). The
  existing `weather.ts` deno suite (fake client, injected positionally) is unaffected.
